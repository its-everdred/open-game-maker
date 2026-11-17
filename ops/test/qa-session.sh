#!/usr/bin/env bash
# ogm-qa-session against a fake API: it sends the internal token, keeps the QA session in a 600 env file by key name and
# never prints the cookie; a refusal writes nothing, and a host without the token stops with 65.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
server_pid=
trap '[[ -n $server_pid ]] && kill $server_pid 2> /dev/null; rm -rf -- "$scratch"' EXIT

export HOME=$scratch/home
export OGM_ENV_DIR=$HOME/.config/ogm/env
mkdir -p "$OGM_ENV_DIR"
session=$repo/ops/bin/ogm-qa-session

# No internal token: a usage stop, nothing written.
printf 'OGM_API_PORT=1\n' > "$OGM_ENV_DIR/api.env"
set +e
"$session" > /dev/null 2> "$scratch/err"
rc=$?
set -e
assert_eq 65 "$rc" 'no internal token exits 65'
assert_grep 'no OGM_INTERNAL_TOKEN' "$scratch/err"
[[ ! -e $OGM_ENV_DIR/qa.env ]] || fail 'a refused run wrote qa.env'

cat > "$scratch/server.mjs" << 'SERVER'
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [log, mode] = process.argv.slice(2);
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    appendFileSync(log, `${req.method} ${req.url} ${req.headers['x-ogm-internal']} ${body}\n`);
    if (mode === 'refuse') {
      res.writeHead(409, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 'qa_email_in_use' } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        userId: 'u_qa',
        email: JSON.parse(body).email,
        gameId: 'g_qa',
        cookie: { name: '__Secure-better-auth.session_token', value: 'SECRET-COOKIE-VALUE' },
        expiresAt: '2026-11-24T00:00:00.000Z',
      }),
    );
  });
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
SERVER

start_server() {
  : > "$scratch/requests"
  node "$scratch/server.mjs" "$scratch/requests" "$1" > "$scratch/port" &
  server_pid=$!
  for _ in $(seq 50); do [[ -s $scratch/port ]] && break; sleep 0.1; done
  printf 'OGM_API_PORT=%s\nOGM_INTERNAL_TOKEN=internal-secret\nOGM_APP_ORIGIN=https://app.example.test\n' \
    "$(cat "$scratch/port")" > "$OGM_ENV_DIR/api.env"
}

# The API refuses (an address already in use): exit 1, nothing written.
start_server refuse
set +e
"$session" > "$scratch/out" 2> "$scratch/err"
rc=$?
set -e
kill "$server_pid"
assert_eq 1 "$rc" 'a refusal exits 1'
assert_grep 'qa_email_in_use' "$scratch/err"
[[ ! -e $OGM_ENV_DIR/qa.env ]] || fail 'a refused run wrote qa.env'

# Saved: the default address comes from the app's host, the env file is 600, and the cookie is never printed.
start_server ok
"$session" > "$scratch/out" 2> "$scratch/err"
assert_grep 'POST /internal/qa/session internal-secret {"email":"qa@app.example.test"}' "$scratch/requests"
assert_eq 600 "$(stat -c %a "$OGM_ENV_DIR/qa.env")" 'qa.env is 600'
assert_grep 'OGM_QA_SESSION_COOKIE=SECRET-COOKIE-VALUE' "$OGM_ENV_DIR/qa.env"
assert_grep 'OGM_QA_GAME_ID=g_qa' "$OGM_ENV_DIR/qa.env"
assert_grep 'OGM_QA_SESSION_COOKIE ' "$scratch/out"
assert_not_grep 'SECRET-COOKIE-VALUE' "$scratch/out"
assert_not_grep 'SECRET-COOKIE-VALUE' "$scratch/err"

# The next run reuses the address it saved.
: > "$scratch/requests"
"$session" > /dev/null
assert_grep '{"email":"qa@app.example.test"}' "$scratch/requests"

echo 'qa-session: ok'
