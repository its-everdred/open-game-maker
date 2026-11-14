#!/usr/bin/env bash
# ogm-status against fake host tools, plus a guard on the hand-steps list.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

status=$repo/ops/bin/ogm-status
bin=$scratch/bin
export HOME=$scratch/home
export OGM_PROC=$scratch/proc
export OGM_BACKUP_STATE=$scratch/state
mkdir -p "$bin" "$HOME/.local/share/ogm" "$OGM_PROC/100" "$OGM_PROC/200" "$OGM_PROC/300" "$OGM_BACKUP_STATE"
printf '0::/user.slice/user-1000.slice/user@1000.service/ogm.slice/ogm-api.service\n' > "$OGM_PROC/100/cgroup"
printf '0::/user.slice/user-1000.slice/session-1.scope\n' > "$OGM_PROC/200/cgroup"
printf 'python3\0-m\0http.server\08792\0' > "$OGM_PROC/200/cmdline"
printf '0::/system.slice/ssh.service\n' > "$OGM_PROC/300/cgroup"
mkdir -p "$HOME/.config/ogm/env"
printf 'OGM_SECRET_VALUE=never-print-me\n' > "$HOME/.config/ogm/env/api.env"

fake() {
  printf '#!/usr/bin/env bash\n%s\n' "$2" > "$bin/$1"
  chmod +x "$bin/$1"
}
fake systemctl "[[ \$2 == show ]] && { cat '$scratch/mainpid-'\"\${@: -1}\" 2> /dev/null || echo 0; exit 0; }
printf 'ogm-api.service loaded active running OGM API\n'"
fake journalctl '[[ " $* " == *" --disk-usage "* ]] && { echo "Archived and active journals take up 2G in the file system."; exit 0; }
printf "PLACEHOLDER rooms\nlistening\nPLACEHOLDER rooms\n"'
ss_lines="LISTEN 0 511 127.0.0.1:3100 0.0.0.0:* users:((\"node\",pid=100,fd=20))
LISTEN 0 5 0.0.0.0:8792 0.0.0.0:* users:((\"python3\",pid=200,fd=3))
LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:((\"sshd\",pid=300,fd=3))"
printf '%s\n' "$ss_lines" > "$scratch/ss.txt"
fake ss "cat '$scratch/ss.txt'"
fake df "printf 'Filesystem Size Used Avail Use%% Mounted on\n/dev/nvme0n1p2 900G 400G 500G 45%% /home\n'"
fake du 'printf "1.5G\t%s\n" "${@: -1}"'
fake tailscale 'exit 1'
export PATH=$bin:$PATH

export OGM_REPO=$scratch/repo
for service in api rooms games-host intake commit; do
  mkdir -p "$OGM_REPO/services/$service/dist"
  printf '{"scripts":{"start":"node dist/main.js"}}\n' > "$OGM_REPO/services/$service/package.json"
  touch "$OGM_REPO/services/$service/dist/main.js"
done

touch "$OGM_BACKUP_STATE/last-ok"
printf '20260101T033000Z\n' > "$OGM_BACKUP_STATE/last-stamp"

"$status" > "$scratch/out.txt"
for section in units placeholders listeners disk sizes backup ingress; do
  assert_grep "== $section" "$scratch/out.txt"
done
assert_eq 1 "$(grep -c '^PLACEHOLDER rooms$' "$scratch/out.txt")" 'placeholders are listed once each'
assert_grep 'ok 127.0.0.1:3100 node pid=100' "$scratch/out.txt"
assert_eq 1 "$(grep -c '^STRAY ' "$scratch/out.txt")" 'exactly one stray listener'
assert_grep 'STRAY 0.0.0.0:8792 python3' "$scratch/out.txt"
assert_not_grep ':22 ' "$scratch/out.txt"
assert_grep 'last 20260101T033000Z, 0 h ago' "$scratch/out.txt"
assert_grep 'journal: 2G' "$scratch/out.txt"
assert_grep 'not operator' "$scratch/out.txt"
assert_not_grep 'never-print-me' "$scratch/out.txt"

set +e
"$status" --check > /dev/null
code=$?
set -e
assert_eq 1 "$code" '--check should fail on a stray listener'

"$status" --json > "$scratch/out.json"
node -e 'const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  for (const k of ["units", "placeholders", "listeners", "disk", "sizes", "backup", "ingress"])
    if (!Array.isArray(o[k])) throw new Error(`missing ${k}`);
  if (!o.listeners.some((l) => l.startsWith("STRAY 0.0.0.0:8792"))) throw new Error("no stray in json");' \
  "$scratch/out.json"

grep -v ':8792 ' "$scratch/ss.txt" > "$scratch/ss.clean" && mv "$scratch/ss.clean" "$scratch/ss.txt"
"$status" --check > /dev/null || fail '--check should pass with no stray and a fresh backup'

# A unit whose built entry is absent would only idle as a placeholder; --check names it.
rm "$OGM_REPO/services/intake/dist/main.js"
set +e
"$status" --check > "$scratch/entry.txt"
code=$?
set -e
assert_eq 1 "$code" '--check should fail on a missing service entry'
assert_grep 'missing entry: services/intake/dist/main.js' "$scratch/entry.txt"
touch "$OGM_REPO/services/intake/dist/main.js"

# A unit that started before the build still idles on its placeholder; the entry existing is not enough.
mkdir -p "$OGM_PROC/400"
printf 'sleep\0infinity\0' > "$OGM_PROC/400/cmdline"
printf '400\n' > "$scratch/mainpid-ogm-rooms.service"
set +e
"$status" --check > "$scratch/idle.txt"
code=$?
set -e
assert_eq 1 "$code" '--check should fail while a built unit still runs its placeholder'
assert_grep 'placeholder running after build: ogm-rooms' "$scratch/idle.txt"
printf 'node\0dist/main.js\0' > "$OGM_PROC/400/cmdline"
"$status" --check > /dev/null || fail '--check should pass once the unit runs its build'

printf '{"scripts":{}}\n' > "$OGM_REPO/services/commit/package.json"
set +e
"$status" --check > "$scratch/nostart.txt"
code=$?
set -e
assert_eq 1 "$code" '--check should fail when a service names no start entry'
assert_grep 'no start entry: services/commit/package.json' "$scratch/nostart.txt"
printf '{"scripts":{"start":"node dist/main.js"}}\n' > "$OGM_REPO/services/commit/package.json"

mkdir -p "$HOME/.local/state/ogm"
printf '{"stale":true}\n' > "$HOME/.local/state/ogm/review-watchdog.json"
set +e
"$status" --check > "$scratch/review-alert.txt"
code=$?
set -e
assert_eq 1 "$code" '--check should fail when the review watchdog alerts'
assert_grep 'review reconciler stale or API unavailable' "$scratch/review-alert.txt"
printf '{"stale":false}\n' > "$HOME/.local/state/ogm/review-watchdog.json"
"$status" --check > /dev/null || fail '--check should pass after the review watchdog recovers'

touch -d '3 days ago' "$OGM_BACKUP_STATE/last-ok"
set +e
"$status" --check > "$scratch/stale.txt"
code=$?
set -e
assert_eq 1 "$code" '--check should fail on a stale backup'
assert_grep 'backup stale' "$scratch/stale.txt"

touch "$OGM_BACKUP_STATE/last-ok"
fake systemctl "printf 'ogm-api.service loaded failed failed OGM API\n'"
set +e
"$status" --check > "$scratch/failed.txt"
code=$?
set -e
assert_eq 1 "$code" '--check should fail on a failed unit'
assert_grep 'unit failed: ogm-api.service' "$scratch/failed.txt"

# Every hand step is a remind-format checkbox, and each external gate appears exactly once.
hand_steps=$repo/docs/ops/hand-steps.md
(( $(grep -c '^- \[ \]' "$hand_steps") >= 8 )) || fail 'hand-steps.md lists fewer than 8 steps'
for gate in GATE-TS-OPERATOR GATE-BACKUP-TARGET GATE-GITHUB-APP GATE-GOOGLE-OAUTH; do
  assert_eq 1 "$(grep -o "$gate" "$hand_steps" | wc -l)" "$gate should appear once in hand-steps.md"
done

printf 'status: ok\n'
