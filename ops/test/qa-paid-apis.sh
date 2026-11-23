#!/usr/bin/env bash
# ogm-qa-paid-apis against a fake API (#1221): it passes only when every game-origin request is refused by the paid-API
# gate; a request the gate lets through fails it; with the setting on it sends nothing, since each request would pass.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
server=
trap '[[ -n $server ]] && kill "$server"; rm -rf -- "$scratch"' EXIT
check=$repo/ops/bin/ogm-qa-paid-apis
games=https://games.example.test

export HOME=$scratch/home OGM_ENV_DIR=$scratch/env
mkdir -p "$OGM_ENV_DIR" "$HOME/.config/ogm/daemons/"{qa-review,castle,attic}
printf 'OGM_GAMES_ORIGIN=%s\n' "$games" > "$OGM_ENV_DIR/api.env"
printf 'OGM_QA_GAME_ID=g_qa\nOGM_QA_SESSION_COOKIE_NAME=s\nOGM_QA_SESSION_COOKIE=c1\n' > "$OGM_ENV_DIR/qa.env"
echo qa-secret > "$HOME/.config/ogm/daemons/qa-review/hook-secret"
echo castle-secret > "$HOME/.config/ogm/daemons/castle/hook-secret"
echo attic-secret > "$HOME/.config/ogm/daemons/attic/hook-secret"

db=$scratch/ogm.sqlite3
python3 - "$db" << 'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute('create table app_meta (key text primary key, value text not null)')
c.execute('create table games (id text, slug text, github_owner text, github_repo text)')
c.execute('create table game_daemons (slug text primary key, repo text)')
# attic sorts first but its game is not linked to the daemon's repository, so the upload route would answer 404.
c.executemany('insert into games values (?, ?, ?, ?)',
              [('g_attic', 'attic', None, None), ('g_castle', 'castle', 'O', 'R'), ('g_qa', 'qa-review', 'o', 'r')])
c.executemany('insert into game_daemons values (?, ?)', [('attic', 'o/r'), ('castle', 'o/r'), ('qa-review', 'o/r')])
c.commit()
PY

# The fake API refuses like the real gate and records each request. `$scratch/broken` names a path it lets through.
cat > "$scratch/api.py" << 'PY'
import io, json, sys, tarfile
from http.server import BaseHTTPRequestHandler, HTTPServer

log, broken = sys.argv[2], sys.argv[3]

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers['content-length']))
        try:
            with open(broken) as handle:
                let_through = handle.read().strip()
        except FileNotFoundError:
            let_through = ''
        if self.path.startswith('/internal/'):
            files = tarfile.open(fileobj=io.BytesIO(body), mode='r:gz')
            names = sorted(files.getnames())
            paid = any(b'api.openai.com' in files.extractfile(name).read() for name in names)
            note = f'{self.path} {self.headers["authorization"]} {" ".join(names)} paid={paid}'
            status, answer = (201, {}) if let_through == 'preview' else (422, {'error': {'code': 'paid_integration'}})
        else:
            note = f'{self.path} {self.headers["origin"]} {self.headers["cookie"]} {body.decode()}'
            status, answer = (400, {'error': 'invalid_body'}) if let_through == self.path else (
                403, {'error': 'paid_apis_off_during_gameplay'})
        with open(log, 'a') as handle:
            handle.write(note + '\n')
        data = json.dumps(answer).encode()
        self.send_response(status)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass

HTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
PY
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 "$scratch/api.py" "$port" "$scratch/requests" "$scratch/broken" &
server=$!
for _ in $(seq 50); do python3 -c "import socket; socket.create_connection(('127.0.0.1', $port))" 2> /dev/null && break; sleep 0.1; done
run() { "$check" --api "http://127.0.0.1:$port" --db "$db" > "$scratch/out"; }

# Every request refused: the check passes.
run
assert_grep 'voice token: refused (403 paid_apis_off_during_gameplay)' "$scratch/out"
assert_grep 'dictation token: refused (403 paid_apis_off_during_gameplay)' "$scratch/out"
assert_grep 'narration: refused (403 paid_apis_off_during_gameplay)' "$scratch/out"
assert_grep 'preview on qa-review: refused (422 paid_integration)' "$scratch/out"
assert_grep 'exit=0 qa-paid-apis' "$scratch/out"
# Each request comes from the games origin as the QA creator; bodies a route rejects after the gate, so it never pays.
assert_grep "/api/v1/voice/token $games s=c1 {}" "$scratch/requests"
assert_grep "/api/v1/games/g_qa/narration/render $games s=c1 {\"lines\":[]}" "$scratch/requests"
# The preview goes to the QA game's daemon, not a person's game, and names a paid host in an otherwise whole build.
# Its cache plan is invalid, so a broken scan would still refuse it (422 cache_plan_invalid) and install nothing.
assert_grep 'Bearer qa-secret assets/cache-plan.json assets/main.js credits.json design/design.json index.html manifest.json paid=True' \
  "$scratch/requests"
assert_not_grep 'castle' "$scratch/requests"

# A request the gate lets through fails the check, each one on its own.
for path in /api/v1/voice/token /api/v1/voice/dictation-token /api/v1/games/g_qa/narration/render preview; do
  echo "$path" > "$scratch/broken"
  set +e
  run
  rc=$?
  set -e
  assert_eq 1 "$rc" "$path let through fails the check"
  assert_grep 'NOT REFUSED' "$scratch/out"
  assert_grep 'exit=1 qa-paid-apis' "$scratch/out"
done
rm "$scratch/broken"

# Without the QA game's daemon it uses another linked game's, never an unlinked one.
rm "$HOME/.config/ogm/daemons/qa-review/hook-secret"
run
assert_grep 'preview on castle: refused (422 paid_integration)' "$scratch/out"

# With paid APIs on, nothing would be refused: it sends nothing and says so.
python3 -c "import sqlite3, sys; c = sqlite3.connect(sys.argv[1]); c.execute(\"insert into app_meta values ('gameplay.paid_apis', 'on')\"); c.commit()" "$db"
: > "$scratch/requests"
run
assert_grep 'paid APIs during gameplay are on' "$scratch/out"
assert_eq '' "$(cat "$scratch/requests")" 'no request with paid APIs on'

# No QA session: bad usage, never a silent pass.
: > "$OGM_ENV_DIR/qa.env"
set +e
run 2> "$scratch/err"
rc=$?
set -e
assert_eq 64 "$rc" 'a missing QA session is a configuration error'
assert_grep 'ogm-qa-session' "$scratch/err"

printf 'ok qa-paid-apis\n'
