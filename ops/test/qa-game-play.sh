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
c.executemany('insert into games values (?, ?, null)',
              [('g_ok', 'ok'), ('g_bad', 'bad'), ('g_qa', 'qa-review'), ('g_new', 'new')])
c.executemany('insert into builds values (?, ?, ?, ?)', [
  ('build_old', 'g_ok', 'tested', '2026-11-20'), ('build_new', 'g_ok', 'tested', '2026-11-21'),
  ('build_bad', 'g_bad', 'tested', '2026-11-21'), ('build_qa', 'g_qa', 'tested', '2026-11-21'),
  ('build_queued', 'g_new', 'queued', '2026-11-21')])
c.commit()
PY

# The fake gm records its call and writes the report the real `gm qa play-check` would: g_bad is stuck on Try again.
cat > "$scratch/gm" << 'GM'
#!/usr/bin/env bash
if [[ $2 == cards-check ]]; then
  printf '%s\n' "$*" >> "$OGM_TEST_CALLS.cards"
  [[ -n ${OGM_TEST_CARDS_FAIL:-} ]] && { printf 'fail: Dusk Helm logo: disappeared 1.2 s after it showed (loading)\n'; exit 1; }
  exit 0
fi
if [[ $2 == frame-check ]]; then
  printf '%s\n' "$*" >> "$OGM_TEST_CALLS.frames"
  [[ -n ${OGM_TEST_FRAME_FAIL:-} ]] && { printf 'fail https://bare.example: refused: frame-ancestors\n'; exit 1; }
  exit 0
fi
printf '%s\n' "$*" >> "$OGM_TEST_CALLS"
game=$3 out=$6
[[ $game == "${OGM_TEST_SILENT:-}" ]] && exit 3
# A flaky game fails its first play only, as a loaded host can.
flake=$OGM_TEST_CALLS.flaked
if [[ $game == "${OGM_TEST_FLAKY:-}" && ! -e $flake ]]; then
  touch "$flake"
  printf '{"failures": ["could not tap \\"Play\\""], "observation": {"trace": []}}\n' > "$out/play-check.json"
  exit 1
fi
if [[ $game == g_bad ]]; then
  cat > "$out/play-check.json" << 'JSON'
{"failures": ["bridge error", "the shell shows Try again"], "unchecked": [], "observation": {"trace": [
  {"ms": 900, "dir": "window", "t": "hello", "n": 1}, {"ms": 950, "dir": "out", "t": "hello", "n": 1},
  {"ms": 1000, "dir": "in", "t": "load.progress", "n": 65},
  {"ms": 1100, "dir": "in", "t": "x\n2026-01-01T00:00:00Z forged line", "n": 1}]}}
JSON
  exit 1
fi
printf '{"failures": [], "unchecked": [], "observation": {"trace": []}}\n' > "$out/play-check.json"
GM
chmod +x "$scratch/gm"
export OGM_QA_GM=$scratch/gm OGM_TEST_CALLS=$scratch/calls OGM_ENV_DIR=$scratch/env
mkdir -p "$scratch/env"
printf 'OGM_PUBLIC_APP_ORIGIN=https://app.example\nOGM_APP_ALIAS_ORIGINS="https://bare.example https://old.example"\n' \
  > "$scratch/env/web.env"
printf 'OGM_GAMES_ORIGIN=https://games.example/\n' > "$scratch/env/api.env"
attention=$scratch/attention

set +e
"$check" --db "$db" --repo "$stack" --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a game stuck on Try again fails'
assert_eq "qa play-check g_bad build_bad --out $stack/assets-local/review/app/play-check/build_bad
qa play-check g_bad build_bad --out $stack/assets-local/review/app/play-check/build_bad
qa play-check g_ok build_new --out $stack/assets-local/review/app/play-check/build_new" "$(cat "$scratch/calls")" \
  'each published game is played at its latest tested build, a failing one twice; QA games are skipped'
assert_grep 'ok build_new: ok' "$scratch/out"
assert_grep 'new: no tested build, not played' "$scratch/out"
# A type the game sent with a newline in it is shown as ?, so it cannot forge an attention line.
line="bad build_bad: bridge error; the shell shows Try again; trace hello>load.progress x65>[?]; host load [0-9]+; stills $stack/assets-local/review/app/play-check/build_bad"
grep -qE "$line" "$scratch/out" || fail "missing failure line: $line"
assert_grep 'exit=1 qa-game-play' "$scratch/out"
assert_eq 1 "$(wc -l < "$attention")" 'one attention line for the one failing game'
grep -qE "qa-game-play failed: $line" "$attention" || fail 'attention line lacks the failure, trace, load and stills'

# The publish hook plays only the game it published.
: > "$scratch/calls"
"$check" --db "$db" --repo "$stack" --game ok > "$scratch/out"
assert_eq "qa play-check g_ok build_new --out $stack/assets-local/review/app/play-check/build_new" "$(cat "$scratch/calls")" \
  '--game plays one game'
assert_grep 'exit=0 qa-game-play' "$scratch/out"

# A game that fails one play and passes the next (a loaded host) is ok, and wakes no one.
: > "$scratch/calls"
: > "$attention"
OGM_TEST_FLAKY=g_ok "$check" --db "$db" --repo "$stack" --game ok --attention "$attention" > "$scratch/out"
assert_grep 'ok build_new: first play failed (could not tap "Play"), playing again' "$scratch/out"
assert_grep 'ok build_new: ok' "$scratch/out"
assert_grep 'exit=0 qa-game-play' "$scratch/out"
[[ ! -s $attention ]] || fail 'a game that passed its second play woke the Executor'

# The publish hook plays the build it just published, even when it is not the latest tested one.
: > "$scratch/calls"
"$check" --db "$db" --repo "$stack" --game ok --build build_old > "$scratch/out"
assert_eq "qa play-check g_ok build_old --out $stack/assets-local/review/app/play-check/build_old" "$(cat "$scratch/calls")" \
  '--build plays that build'
set +e
"$check" --db "$db" --repo "$stack" --game ok --build build_bad > /dev/null 2>&1
rc=$?
set -e
assert_eq 64 "$rc" "another game's build is refused"
set +e
"$check" --db "$db" --repo "$stack" --game ok --build '' > /dev/null 2>&1
rc=$?
set -e
assert_eq 64 "$rc" 'an empty build id is refused, never replaced by the latest build'

# A play that dies before writing its report fails; it never passes for lack of evidence.
set +e
OGM_TEST_SILENT=g_ok "$check" --db "$db" --repo "$stack" --game ok > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a play with no report fails'
assert_grep 'ok build_new: check/host problem: gm qa play-check exited 3 without a report' "$scratch/out"

# Bad usage.
set +e
"$check" --db "$db" --game > /dev/null 2>&1
rc=$?
set -e
assert_eq 64 "$rc" 'a flag without its value is bad usage'

# The check itself crashing is not "a game failed": exit 70, and no attention line pretends otherwise.
: > "$attention"
set +e
"$check" --db "$scratch/not-a-db" --repo "$stack" --attention "$attention" > /dev/null 2>&1
rc=$?
printf 'not sqlite' > "$scratch/broken.sqlite3"
"$check" --db "$scratch/broken.sqlite3" --repo "$stack" --attention "$attention" > "$scratch/out" 2>&1
crash=$?
set -e
assert_eq 64 "$rc" 'a missing database is bad usage'
assert_eq 70 "$crash" 'a crash exits 70'
assert_grep 'exit=70 qa-game-play' "$scratch/out"
[[ ! -s $attention ]] || fail 'a crash wrote an attention line'

# Every app domain frames the first game's build in WebKit before any play (#1297); a refused frame fails and wakes
# the Executor, and --frames-only (web deploys) plays nothing.
: > "$scratch/calls"
: > "$scratch/calls.frames"
"$check" --db "$db" --repo "$stack" --game ok > "$scratch/out"
frame='qa frame-check https://games.example/g/g_ok/build_new/ --app https://app.example --app https://bare.example --app https://old.example'
assert_eq "$frame" "$(cat "$scratch/calls.frames")" 'the app origin first, then each alias, frame the played build'
assert_eq "qa play-check g_ok build_new --out $stack/assets-local/review/app/play-check/build_new" "$(cat "$scratch/calls")" \
  'the game still plays after its frame check'
assert_grep 'frames ok build_new: ok on https://app.example https://bare.example https://old.example' "$scratch/out"

: > "$scratch/calls"
: > "$scratch/calls.frames"
: > "$attention"
set +e
OGM_TEST_FRAME_FAIL=1 "$check" --db "$db" --repo "$stack" --frames-only --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a refused frame fails'
assert_eq "${frame/g_ok\/build_new/g_bad/build_bad}" "$(sed -n 1p "$scratch/calls.frames")" \
  'without --game the first game with a tested build is framed'
assert_eq 2 "$(wc -l < "$scratch/calls.frames")" 'a failing frame check runs once more'
[[ ! -s $scratch/calls ]] || fail '--frames-only played a game'
assert_grep 'qa-frame-check failed: frames bad build_bad: fail https://bare.example: refused: frame-ancestors' "$attention"

# Every game card's thumbnail and logo must show and stay on the app origin's list (#1312), on web deploys too; a
# card that blanks fails and wakes the Executor after one more check.
: > "$scratch/calls.cards"
"$check" --db "$db" --repo "$stack" --game ok > "$scratch/out"
cards="qa cards-check --app https://app.example --out $stack/assets-local/review/app/cards-check"
assert_eq "$cards" "$(cat "$scratch/calls.cards")" 'the cards are checked once on the app origin'
assert_grep 'cards: ok' "$scratch/out"
: > "$scratch/calls.cards"
: > "$attention"
set +e
OGM_TEST_CARDS_FAIL=1 "$check" --db "$db" --repo "$stack" --frames-only --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'a card whose logo vanishes fails'
assert_eq 2 "$(wc -l < "$scratch/calls.cards")" 'a failing cards check runs once more'
assert_grep "qa-cards-check failed: cards: fail: Dusk Helm logo: disappeared 1.2 s after it showed (loading); report $stack/assets-local/review/app/cards-check" "$attention"

# A host missing the app or games origin cannot be checked: that fails loudly in every mode, never passes.
mv "$scratch/env/api.env" "$scratch/api.env"
: > "$attention"
set +e
"$check" --db "$db" --repo "$stack" --game ok --attention "$attention" > "$scratch/out"
rc=$?
set -e
assert_eq 1 "$rc" 'an unconfigured frame check fails the run'
assert_grep 'qa-frame-check failed: frames: not checked: OGM_PUBLIC_APP_ORIGIN in web.env or OGM_GAMES_ORIGIN' "$attention"
mv "$scratch/api.env" "$scratch/env/api.env"

echo 'qa-game-play: ok'
