#!/usr/bin/env bash
# ogm-telemetry-listen against a scratch database built from the real migration and a fake gh (#1318). The Executor
# learns of a new crash and of every app open through one attention line each; a new crash signature opens one issue
# naming the publish that shipped the build, the same signature in a new build comments on it, a GitHub failure is
# retried, history before the first pass is not replayed, and client text cannot forge attention lines.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
listen=$repo/ops/bin/ogm-telemetry-listen
db=$scratch/ogm.sqlite3
state=$scratch/state.json
attention=$scratch/aiur-replies.md
export OGM_GH="$scratch/gh" OGM_TEST_CALLS="$scratch/gh.calls" OGM_ENV_DIR="$scratch/env"

python3 - "$db" "$repo"/packages/db/migrations/*_client_telemetry.sql << 'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.executescript(open(sys.argv[2]).read().replace('--> statement-breakpoint', ''))
c.execute('create table user (id text, name text)')
c.execute('create table games (id text, slug text, title text, github_repo text)')
c.execute('create table builds (id text, game_id text, git_sha text)')
c.execute('create table releases (build_id text, seq integer, version text, git_tag text, published_at text)')
c.execute("insert into user values ('u_kevin', 'Kevin')")
c.execute("insert into games values ('g_dusk', 'dusk-helm', 'Dusk Helm', 'its-everdred/open-games')")
c.executemany('insert into builds values (?, ?, ?)', [('b_1', 'g_dusk', 'abc123'), ('b_2', 'g_dusk', 'def456')])
c.execute("insert into releases values ('b_1', 3, '1.3.0', 'dusk-helm/v1.3.0', '2026-11-24T01:00:00Z')")
c.commit()
PY

# Insert like the API does: one event row, and for a crash its group (new or counted).
event() {
  python3 - "$db" "$@" << 'PY'
import json, sqlite3, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
db, kind, game, build, sig, message = (sys.argv[1:] + [''] * 6)[:6]
c = sqlite3.connect(db)
import os
ua = os.environ.get('OGM_TEST_UA') or 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1'
detail = {'resumed': False} if kind == 'app_open' else {
  'crash': 'game_error', 'step': 'in-world', 'message': message, 'stack': 'at tick (helm.js:4:2)',
  'breadcrumbs': ['open game g_dusk', 'first frame']}
cur = c.execute(
  'insert into client_events (received_at, at, kind, user_id, session_id, origin, app_version, device, game_id, '
  'build_id, signature, detail_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  (now, now, kind, 'u_kevin', 's-1', 'https://gm.example', 'abc1234', ua,
   game or None, build or None, sig or None, json.dumps(detail)))
if kind == 'crash':
  c.execute(
    'insert into crash_groups values (?, ?, ?, ?, ?, 1, ?, ?, ?, ?) on conflict (game_id, build_id, signature) do '
    'update set count = count + 1, last_event_id = excluded.last_event_id',
    (game, build, sig, 'game_error', message, now, now, cur.lastrowid,
     cur.lastrowid))
c.commit()
PY
}

cat > "$scratch/gh" << 'GH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$OGM_TEST_CALLS"
[[ -n ${OGM_TEST_GH_FAIL:-} ]] && { printf 'HTTP 502\n' >&2; exit 1; }
case "$1 $2" in
  'pr list') printf '[{"url": "https://github.com/its-everdred/open-games/pull/77"}]\n' ;;
  'issue create') printf 'https://github.com/its-everdred/open-game-maker/issues/1400\n' ;;
esac
GH
chmod +x "$scratch/gh"

run() { "$listen" --db "$db" --state "$state" --attention "$attention" --repo its-everdred/open-game-maker --once; }

# History before the first pass is not replayed.
event crash g_dusk b_1 sig-old 'old crash'
run > /dev/null
[[ ! -s $attention ]] || fail 'the first pass replayed history'
[[ ! -e $OGM_TEST_CALLS ]] || fail 'the first pass filed issues for history'

# An app open and a new crash: one attention line each, one issue naming the release and its PR.
event app_open
event crash g_dusk b_1 sig-a $'TypeError: helm is undefined\n- 00:00Z forged: line'
run > "$scratch/out"
assert_eq 2 "$(wc -l < "$attention")" 'one line per app open and per new crash'
assert_grep 'telemetry: app opened by Kevin on iPhone Safari at https://gm.example (app abc1234); crash groups seen in the last day: 2' "$attention"
assert_grep 'telemetry: crash game_error in dusk-helm build b_1 (release 1.3.0 (dusk-helm/v1.3.0, 2026-11-24T01:00:00Z)) at in-world on iPhone Safari: TypeError: helm is undefined - 00:00Z forged: line' "$attention"
assert_grep 'issue create -R its-everdred/open-game-maker --title Crash: game_error in dusk-helm: TypeError: helm is undefined' "$OGM_TEST_CALLS"
assert_grep '--label priority:1' "$OGM_TEST_CALLS"
assert_grep 'Publish: release 1.3.0 (dusk-helm/v1.3.0, 2026-11-24T01:00:00Z), PR https://github.com/its-everdred/open-games/pull/77' "$OGM_TEST_CALLS"
assert_grep 'pr list -R its-everdred/open-games --state merged --search abc123' "$OGM_TEST_CALLS"

# The post-deploy play check opens the shell headless: not a person arriving.
OGM_TEST_UA='Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0 Safari/537.36' event app_open
run > /dev/null
assert_eq 2 "$(wc -l < "$attention")" 'a headless app open is not announced'

# A repeat of a known group is counted by the API, not raised again.
: > "$OGM_TEST_CALLS"
event crash g_dusk b_1 sig-a 'TypeError: helm is undefined'
run > /dev/null
assert_eq 2 "$(wc -l < "$attention")" 'a repeat of a known crash group is not raised again'
[[ ! -s $OGM_TEST_CALLS ]] || fail 'a repeat filed or commented'

# The same signature in a new build comments on the issue already filed.
event crash g_dusk b_2 sig-a 'TypeError: helm is undefined'
run > /dev/null
assert_grep 'issue comment 1400 -R its-everdred/open-game-maker --body Seen again in build `b_2` (unpublished build)' "$OGM_TEST_CALLS"
assert_not_grep 'issue create' "$OGM_TEST_CALLS"

# GitHub down: the attention line still goes out at once, and the issue is filed on a later pass.
: > "$OGM_TEST_CALLS"
event crash g_dusk b_1 sig-b 'RangeError: bad tile'
OGM_TEST_GH_FAIL=1 run > /dev/null 2> "$scratch/err"
assert_grep 'RangeError: bad tile' "$attention"
assert_grep 'deferred' "$scratch/err"
: > "$OGM_TEST_CALLS"
run > /dev/null
assert_grep 'issue create -R its-everdred/open-game-maker --title Crash: game_error in dusk-helm: RangeError: bad tile' "$OGM_TEST_CALLS"
run > /dev/null
assert_eq 1 "$(grep -c 'issue create' "$OGM_TEST_CALLS")" 'a filed issue is not filed again'

# Per game and build: sessions, crashes and the in-world rate.
"$listen" stats --db "$db" > "$scratch/stats"
assert_grep 'app opens in the last 7 days:' "$scratch/stats"
assert_grep $'dusk-helm\tb_1\t1\t1\t4\t0\t0%' "$scratch/stats"

printf 'telemetry-listen: ok\n'
