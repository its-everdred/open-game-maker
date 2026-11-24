#!/usr/bin/env bash

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

home=$scratch/home
config_home=$scratch/config
fake_bin=$scratch/bin
log=$scratch/calls.log
mkdir -p "$home" "$config_home" "$fake_bin"
for tool in systemctl systemd-run; do
  printf '#!/usr/bin/env bash\nprintf "%s %%s\\n" "$*" >> "%s"\n' "$tool" "$log" > "$fake_bin/$tool"
  chmod +x "$fake_bin/$tool"
done

start() {
  HOME=$home XDG_CONFIG_HOME=$config_home OGM_SYSTEMCTL=$fake_bin/systemctl OGM_SYSTEMD_RUN=$fake_bin/systemd-run \
    "$repo/ops/bin/ogm-prod-start" "$@"
}

start games

# The games host runs in the prod slice (not the caller's cgroup), so the fleet can't starve it (#1319).
assert_grep "--unit=ogm-prod-games --slice=ogm-prod.slice" "$log"
assert_grep "WorkingDirectory=$repo/services/games-host" "$log"
assert_grep "EnvironmentFile=-$home/.config/ogm/env/games.env" "$log"
assert_grep "$repo/ops/bin/ogm-run games" "$log"
assert_grep 'KillMode=mixed' "$log"
# The slice's weights only apply if its unit file is installed, so the launcher installs it.
cmp -s "$repo/ops/systemd/ogm-prod.slice" "$config_home/systemd/user/ogm-prod.slice" || fail "ogm-prod.slice not installed"
assert_grep 'systemctl --user daemon-reload' "$log"
# A restart replaces the previous unit rather than failing on the name.
assert_grep 'systemctl --user stop ogm-prod-games.service' "$log"

# Installed and unchanged: no reload on the next start.
: > "$log"
start api
assert_not_grep 'daemon-reload' "$log"
assert_grep "WorkingDirectory=$repo/services/api" "$log"

set +e
start web 2> "$scratch/err"
status=$?
set -e
assert_eq "64" "$status" "an unknown service should be refused"

printf 'ok prod-start\n'
