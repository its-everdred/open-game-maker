#!/usr/bin/env bash

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

empty_repo=$scratch/empty-repo
home=$scratch/home
mkdir -p "$empty_repo" "$home"

for service in api review-watchdog rooms games commit voice-host intake; do
  set +e
  HOME=$home OGM_REPO=$empty_repo timeout 2 "$repo/ops/bin/ogm-run" "$service" \
    > "$scratch/$service.out" 2> "$scratch/$service.err"
  status=$?
  set -e
  assert_eq "124" "$status" "an absent $service service should keep its placeholder running"
  assert_grep "PLACEHOLDER $service" "$scratch/$service.err"
done

# The unit runs the file the package's start script names, not a fixed dist/index.js.
built_repo=$scratch/built-repo
mkdir -p "$built_repo/services/api/dist"
printf '{"scripts":{"start":"node dist/main.js"}}\n' > "$built_repo/services/api/package.json"
cat > "$built_repo/services/api/dist/main.js" <<'EOF'
process.stdout.write('api-up');
EOF
api_output=$(HOME=$home OGM_REPO=$built_repo timeout 5 "$repo/ops/bin/ogm-run" api)
assert_eq "api-up" "$api_output" "a built API should be executed"

# The games unit's package lives in services/games-host.
mkdir -p "$built_repo/services/games-host/dist"
printf '{"scripts":{"start":"node dist/index.js"}}\n' > "$built_repo/services/games-host/package.json"
printf "process.stdout.write('games-up');\n" > "$built_repo/services/games-host/dist/index.js"
games_output=$(HOME=$home OGM_REPO=$built_repo timeout 5 "$repo/ops/bin/ogm-run" games)
assert_eq "games-up" "$games_output" "the games unit should run the games-host build"

mkdir -p "$built_repo/services/rooms"
printf '{"scripts":{"start":"node dist/main.js"}}\n' > "$built_repo/services/rooms/package.json"
set +e
HOME=$home OGM_REPO=$built_repo timeout 2 "$repo/ops/bin/ogm-run" rooms > /dev/null 2> "$scratch/rooms-unbuilt.err"
status=$?
set -e
assert_eq "124" "$status" "a package without a build should keep its placeholder running"
assert_grep 'PLACEHOLDER rooms' "$scratch/rooms-unbuilt.err"

mkdir -p "$built_repo/services/intake"
printf '{"scripts":{}}\n' > "$built_repo/services/intake/package.json"
set +e
HOME=$home OGM_REPO=$built_repo timeout 2 "$repo/ops/bin/ogm-run" intake > /dev/null 2> "$scratch/intake-nostart.err"
status=$?
set -e
assert_eq "1" "$status" "a package with no start script should fail its unit, not idle"
assert_grep 'start script is not "node <file>"' "$scratch/intake-nostart.err"

mkdir -p "$built_repo/services/commit/dist"
printf '{"scripts":{"start":"node dist/index.js"}}\n' > "$built_repo/services/commit/package.json"
printf "process.stdout.write('commit-up');\n" > "$built_repo/services/commit/dist/index.js"
commit_output=$(HOME=$home OGM_REPO=$built_repo timeout 5 "$repo/ops/bin/ogm-run" commit)
assert_eq "commit-up" "$commit_output" "a built commit service should be executed"

set +e
HOME=$home OGM_REPO=$empty_repo timeout 2 "$repo/ops/bin/ogm-run" drive-sync > "$scratch/drive.out" 2> "$scratch/drive.err"
status=$?
set -e
assert_eq "124" "$status" "Drive sync should wait when setup is incomplete"
assert_grep 'PLACEHOLDER drive-sync: waiting for Drive setup' "$scratch/drive.err"

set +e
HOME=$home OGM_REPO=$empty_repo timeout 2 "$repo/ops/bin/ogm-run" aiur example-game \
  > "$scratch/aiur.out" 2> "$scratch/aiur.err"
status=$?
set -e
assert_eq "124" "$status" "an absent game repo should keep its aiur placeholder running"
assert_grep 'PLACEHOLDER aiur' "$scratch/aiur.err"

game_repo=$home/.local/share/ogm/repos/example-game
mkdir -p "$game_repo/.aiur" "$home/.local/bin"
touch "$game_repo/.aiur/config"
cat > "$home/.local/bin/aiur" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$PWD" "$*"
EOF
chmod +x "$home/.local/bin/aiur"

set +e
HOME=$home OGM_REPO=$empty_repo timeout 2 "$repo/ops/bin/ogm-run" aiur example-game \
  > "$scratch/aiur-cookie.out" 2> "$scratch/aiur-cookie.err"
status=$?
set -e
assert_eq "124" "$status" "aiur should wait when its cookie is missing"
assert_grep 'PLACEHOLDER aiur' "$scratch/aiur-cookie.err"

aiur_output=$(HOME=$home OGM_REPO=$empty_repo AIUR_ERLANG_COOKIE=test-cookie \
  "$repo/ops/bin/ogm-run" aiur example-game)
assert_eq "$game_repo|run --container" "$aiur_output" "a configured aiur daemon should run in its game repo"

set +e
HOME=$home OGM_REPO=$empty_repo "$repo/ops/bin/ogm-run" aiur > "$scratch/aiur-missing.out" 2> "$scratch/aiur-missing.err"
status=$?
set -e
assert_eq "64" "$status" "aiur should require exactly one game slug"
assert_grep 'usage: ogm-run' "$scratch/aiur-missing.err"

set +e
HOME=$home env -u OGM_REPO "$repo/ops/bin/ogm-run" api > "$scratch/unset.out" 2> "$scratch/unset.err"
status=$?
set -e
[[ $status -ne 0 ]] || fail "ogm-run should reject an unset OGM_REPO"
assert_grep 'OGM_REPO' "$scratch/unset.err"

HOME=$home OGM_REPO=$empty_repo "$repo/ops/bin/ogm-run" backup > "$scratch/backup.out" 2> "$scratch/backup.err"
assert_grep 'PLACEHOLDER backup' "$scratch/backup.err"

printf 'ogm-run tests passed\n'
