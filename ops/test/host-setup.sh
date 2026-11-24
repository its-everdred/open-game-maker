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
systemctl_log=$scratch/systemctl.log
mkdir -p "$home" "$config_home" "$fake_bin"

cat > "$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$OGM_SYSTEMCTL_LOG"
EOF
cat > "$fake_bin/sudo" <<'EOF'
#!/usr/bin/env bash
exit 99
EOF
chmod +x "$fake_bin/systemctl" "$fake_bin/sudo"

run_setup() {
  HOME=$home \
    XDG_CONFIG_HOME=$config_home \
    OGM_SYSTEMCTL=$fake_bin/systemctl \
    OGM_SYSTEMCTL_LOG=$systemctl_log \
    PATH=$fake_bin:$PATH \
    "$repo/ops/bin/ogm-host-setup.sh"
}

run_setup > "$scratch/first.out"

unit_dir=$config_home/systemd/user
[[ -x $repo/ops/bin/ogm-run ]] || fail "ogm-run should be executable"
unit_count=$(find "$unit_dir" -maxdepth 1 -type f | wc -l)
assert_eq "21" "$unit_count" "installer should render all twenty-one unit files"

if grep -R -Fq -- '@REPO@' "$unit_dir"; then
  fail "rendered unit files still contain @REPO@"
fi

for spec in \
  'api:api' \
  'rooms:rooms' \
  'games:games' \
  'commit:ogm-commit' \
  'voice-host:voice-host' \
  'intake:intake' \
  'drive-sync:drive-sync'; do
  unit=${spec%%:*}
  env_name=${spec#*:}
  file=$unit_dir/ogm-$unit.service
  assert_grep 'Type=simple' "$file"
  case $unit in
    api | rooms | games | commit | voice-host) assert_grep 'Slice=ogm-prod.slice' "$file" ;;
    *) assert_grep 'Slice=ogm.slice' "$file" ;;
  esac
  assert_grep "Environment=OGM_REPO=$repo" "$file"
  assert_grep "EnvironmentFile=-%h/.config/ogm/env/$env_name.env" "$file"
  assert_grep "ExecStart=$repo/ops/bin/ogm-run $unit" "$file"
  assert_grep 'Restart=on-failure' "$file"
  assert_grep 'RestartSec=5' "$file"
  assert_grep 'UMask=0077' "$file"
  assert_grep 'NoNewPrivileges=yes' "$file"
  assert_grep 'KillMode=mixed' "$file"
  assert_grep 'TimeoutStopSec=30' "$file"
  assert_grep 'LogRateLimitIntervalSec=30' "$file"
  assert_grep 'LogRateLimitBurst=1000' "$file"
  assert_grep 'WantedBy=default.target' "$file"
done

assert_grep 'ProtectHome=read-only' "$unit_dir/ogm-commit.service"
assert_grep 'ReadWritePaths=-%h/.local/share/ogm' "$unit_dir/ogm-commit.service"

assert_grep 'CPUWeight=200' "$unit_dir/ogm.slice"
# Prod serving must win CPU and IO under fleet load (#1319): inside ogm.slice it outweighs the agents slice and a
# host's game-builder fleet slice (default weight 100).
assert_grep 'CPUWeight=10000' "$unit_dir/ogm-prod.slice"
assert_grep 'IOWeight=1000' "$unit_dir/ogm-prod.slice"
assert_grep 'IOWeight=10' "$unit_dir/ogm-agents.slice"
assert_grep 'CPUWeight=50' "$unit_dir/ogm-agents.slice"
assert_grep 'MemoryMax=16G' "$unit_dir/ogm-agents.slice"
assert_grep 'TasksMax=4096' "$unit_dir/ogm-agents.slice"
assert_grep 'Slice=ogm-agents.slice' "$unit_dir/ogm-aiur@.service"
assert_grep 'WorkingDirectory=%h/.local/share/ogm/daemons/%i' "$unit_dir/ogm-aiur@.service"
assert_grep 'EnvironmentFile=%h/.config/ogm/env/ogm-aiur@%i.env' "$unit_dir/ogm-aiur@.service"
assert_grep 'ExecStart=%h/github/aiur/scripts/aiurdev run --container' "$unit_dir/ogm-aiur@.service"
assert_grep 'StartLimitBurst=3' "$unit_dir/ogm-aiur@.service"
assert_grep 'Restart=on-failure' "$unit_dir/ogm-aiur@.service"
assert_grep 'RestartSec=10' "$unit_dir/ogm-aiur@.service"
assert_grep 'KillMode=mixed' "$unit_dir/ogm-aiur@.service"
assert_grep 'TimeoutStopSec=65' "$unit_dir/ogm-aiur@.service"
assert_grep 'UMask=0077' "$unit_dir/ogm-aiur@.service"
assert_grep 'NoNewPrivileges=yes' "$unit_dir/ogm-aiur@.service"
assert_not_grep 'ProtectHome' "$unit_dir/ogm-aiur@.service"
assert_grep 'Type=oneshot' "$unit_dir/ogm-backup.service"
assert_grep 'Slice=ogm.slice' "$unit_dir/ogm-backup.service"
assert_grep 'EnvironmentFile=-%h/.config/ogm/env/backup.env' "$unit_dir/ogm-backup.service"
assert_grep "ExecStart=$repo/ops/bin/ogm-run backup" "$unit_dir/ogm-backup.service"
assert_grep 'UMask=0077' "$unit_dir/ogm-backup.service"
assert_grep 'NoNewPrivileges=yes' "$unit_dir/ogm-backup.service"
assert_not_grep 'Restart=' "$unit_dir/ogm-backup.service"
assert_grep 'OnCalendar=*-*-* 03:30:00' "$unit_dir/ogm-backup.timer"
assert_grep 'Persistent=true' "$unit_dir/ogm-backup.timer"
assert_grep 'RandomizedDelaySec=300' "$unit_dir/ogm-backup.timer"
assert_grep 'WantedBy=timers.target' "$unit_dir/ogm-backup.timer"

assert_grep 'Type=oneshot' "$unit_dir/ogm-core-bump.service"
assert_grep 'Slice=ogm.slice' "$unit_dir/ogm-core-bump.service"
assert_grep 'EnvironmentFile=-%h/.config/ogm/env/core-bump.env' "$unit_dir/ogm-core-bump.service"
assert_grep "ExecStart=$repo/ops/bin/ogm-run core-bump" "$unit_dir/ogm-core-bump.service"
assert_grep 'NoNewPrivileges=yes' "$unit_dir/ogm-core-bump.service"
assert_not_grep 'Restart=' "$unit_dir/ogm-core-bump.service"
assert_grep 'OnUnitActiveSec=15min' "$unit_dir/ogm-core-bump.timer"
assert_grep 'WantedBy=timers.target' "$unit_dir/ogm-core-bump.timer"
assert_grep 'OnCalendar=daily' "$unit_dir/ogm-qa-new-game.timer"
assert_grep 'Persistent=true' "$unit_dir/ogm-qa-new-game.timer"
assert_grep "ExecStart=$repo/ops/bin/ogm-qa-new-game-daily" "$unit_dir/ogm-qa-new-game.service"
assert_grep 'TimeoutStartSec=infinity' "$unit_dir/ogm-qa-new-game.service"
assert_grep 'OnUnitInactiveSec=10min' "$unit_dir/ogm-qa-publish-review.timer"
assert_grep 'WantedBy=timers.target' "$unit_dir/ogm-qa-publish-review.timer"
assert_grep "ExecStart=$repo/ops/bin/ogm-qa-review-hook --publish-sweep --repo $repo" "$unit_dir/ogm-qa-publish-review.service"
assert_grep 'EnvironmentFile=-%h/.config/ogm/env/qa-hook.env' "$unit_dir/ogm-qa-publish-review.service"
assert_grep 'TimeoutStartSec=5min' "$unit_dir/ogm-qa-publish-review.service"

env_mode=$(stat -c '%a' "$home/.config/ogm/env")
assert_eq "700" "$env_mode" "environment directory should be private"

expected_log=$'--user daemon-reload\n--user enable --now ogm-api ogm-review-watchdog ogm-rooms ogm-games ogm-commit ogm-voice-host ogm-intake ogm-drive-sync ogm-backup.timer ogm-core-bump.timer ogm-qa-new-game.timer ogm-qa-publish-review.timer ogm-telemetry-listen\n--user list-units ogm-* --no-pager'
actual_log=$(cat "$systemctl_log")
assert_eq "$expected_log" "$actual_log" "systemctl calls should follow the required order"

find "$unit_dir" -maxdepth 1 -type f -printf '%P %i %s %T@\n' | sort > "$scratch/tree-before"
run_setup > "$scratch/second.out"
find "$unit_dir" -maxdepth 1 -type f -printf '%P %i %s %T@\n' | sort > "$scratch/tree-after"
diff -u "$scratch/tree-before" "$scratch/tree-after"

expected_twice=$expected_log$'\n'$expected_log
actual_twice=$(cat "$systemctl_log")
assert_eq "$expected_twice" "$actual_twice" "a second run should make the same systemctl calls"

dry_home=$scratch/dry-home
dry_config=$scratch/dry-config
dry_log=$scratch/dry-systemctl.log
mkdir -p "$dry_home" "$dry_config"
HOME=$dry_home \
  XDG_CONFIG_HOME=$dry_config \
  OGM_SYSTEMCTL=$fake_bin/systemctl \
  OGM_SYSTEMCTL_LOG=$dry_log \
  PATH=$fake_bin:$PATH \
  "$repo/ops/bin/ogm-host-setup.sh" --dry-run > "$scratch/dry.out"

[[ ! -e "$dry_config/systemd/user" ]] || fail "dry run should not create the unit directory"
[[ ! -s "$dry_log" ]] || fail "dry run should not call systemctl"
assert_grep 'enable ogm-api ogm-review-watchdog ogm-rooms ogm-games ogm-commit ' "$scratch/dry.out"

stop_log=$scratch/stop-systemctl.log
HOME=$home \
  XDG_CONFIG_HOME=$config_home \
  OGM_SYSTEMCTL=$fake_bin/systemctl \
  OGM_SYSTEMCTL_LOG=$stop_log \
  PATH=$fake_bin:$PATH \
  "$repo/ops/bin/ogm-host-setup.sh" --stop
expected_stop='--user disable --now ogm-api ogm-review-watchdog ogm-rooms ogm-games ogm-commit ogm-voice-host ogm-intake ogm-drive-sync ogm-backup.timer ogm-core-bump.timer ogm-qa-new-game.timer ogm-qa-publish-review.timer ogm-telemetry-listen'
actual_stop=$(cat "$stop_log")
assert_eq "$expected_stop" "$actual_stop" "stop mode should disable every enabled unit"

printf 'host setup tests passed\n'
