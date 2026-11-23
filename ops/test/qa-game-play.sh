#!/usr/bin/env bash
# ogm-qa-game-play against a scratch database and a fake gm (#1272): each published game's latest tested build is played
# once, QA games are skipped, --game plays one game, and a game that does not play exits 1 with one attention line naming
# its failures, the bridge messages it got, and where its stills are. A play that writes no report is a failure too.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
check=$repo/ops/bin/ogm-qa-game-play
stack=$scratch/repo
mkdir -p "$stack"

db=$scratch/ogm.sqlite3
python3 - "$db" << 'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute('create table games (id text, slug text, delisted_at text)')
c.execute('create table builds (id text, game_id text, status text, created_at text)')
c.executemany('insert into games values (?, ?, null)', [('g_ok', 'ok'), ('g_bad', 'bad'), ('g_qa', 'qa-review')])
c.executemany('insert into builds values (?, ?, ?, ?)', [
  ('build_old', 'g_ok', 'tested', '2026-11-20'), ('build_new', 'g_ok', 'tested', '2026-11-21'),
  ('build_bad', 'g_bad', 'tested', '2026-11-21'), ('build_qa', 'g_qa', 'tested', '2026-11-21')])
c.commit()
PY

# The fake gm records its call and writes the report the real `gm qa play-check` would: g_bad is stuck on Try again.
cat > "$scratch/gm" << 'GM'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$OGM_TEST_CALLS"
game=$3 out=$6
[[ $game == "${OGM_TEST_SILENT:-}" ]] && exit 3
if [[ $game == g_bad ]]; then
  cat > "$out/play-check.json" << 'JSON'
{"failures": ["bridge error", "the shell shows Try again"], "unchecked": [], "observation": {"trace": [
  {"ms": 900, "dir": "window", "t": "hello", "n": 1}, {"ms": 950, "dir": "out", "t": "hello", "n": 1},
  {"ms": 1000, "dir": "in", "t": "load.progress", "n": 65}]}}
JSON
  exit 1
fi
printf '{"failures": [], "unchecked": [], "observation": {"trace": []}}\n' > "$out/play-check.json"
GM
chmod +x "$scratch/gm"
export OGM_QA_GM=$scratch/gm OGM_TEST_CALLS=$scratch/calls OGM_ENV_DIR=$scratch/env
attention=$scratch/attention

set +e
"$check" --db "$db" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a game stuck on Try again fails'
assert_eq "qa play-check g_bad build_bad --out $stack/assets-local/review/app/play-check/build_bad
qa play-check g_ok build_new --out $stack/assets-local/review/app/play-check/build_new" "$(cat "$scratch/calls")" \
  'each published game is played once, at its latest tested build; QA games are skipped'
assert_grep 'ok build_new: ok' "$scratch/out"
line="bad build_bad: bridge error; the shell shows Try again; trace hello>load.progress x65; stills $stack/assets-local/review/app/play-check/build_bad"
assert_grep "$line" "$scratch/out"
assert_grep 'exit=1 qa-game-play' "$scratch/out"
assert_eq 1 "$(wc -l < "$attention")" 'one attention line for the one failing game'
assert_grep "qa-game-play failed: $line" "$attention"

# The publish hook plays only the game it published.
: > "$scratch/calls"
"$check" --db "$db" --repo "$stack" --game ok > "$scratch/out"
assert_eq "qa play-check g_ok build_new --out $stack/assets-local/review/app/play-check/build_new" "$(cat "$scratch/calls")" \
  '--game plays one game'
assert_grep 'exit=0 qa-game-play' "$scratch/out"

# A play that dies before writing its report fails; it never passes for lack of evidence.
set +e
OGM_TEST_SILENT=g_ok "$check" --db "$db" --repo "$stack" --game ok > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a play with no report fails'
assert_grep 'ok build_new: gm qa play-check exited 3 without a report' "$scratch/out"

# Bad usage.
set +e
"$check" --db "$db" --game > /dev/null 2>&1
rc=$?
set -e
assert_eq 64 "$rc" 'a flag without its value is bad usage'

echo 'qa-game-play: ok'
