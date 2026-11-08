#!/usr/bin/env bash
# ogm-qa-signin against a fake app: it asks for a magic link, reads it from the admin inbox (mail_outbox), opens it,
# accepts a pending member invitation only while the account has no family, and saves a 600 storage state that carries
# the session cookie. Without a QA address or a database it stops with 65 before touching anything.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
server_pid=
trap '[[ -n $server_pid ]] && kill $server_pid 2> /dev/null; rm -rf -- "$scratch"' EXIT

# Playwright finds its browsers under HOME, which the test moves.
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}
export HOME=$scratch/home
export OGM_ENV_DIR=$HOME/.config/ogm/env
mkdir -p "$OGM_ENV_DIR" "$scratch/data"
signin=$repo/ops/bin/ogm-qa-signin

# No QA address: a usage stop, no state written.
printf 'OGM_APP_ORIGIN=http://127.0.0.1:1\nOGM_DATA_DIR=%s\n' "$scratch/data" > "$OGM_ENV_DIR/api.env"
set +e
"$signin" > /dev/null 2> "$scratch/err"
rc=$?
set -e
assert_eq 65 "$rc" 'no QA address exits 65'
assert_grep 'no QA address' "$scratch/err"

# No database: same stop.
printf 'OGM_QA_EMAILS=QA@example.com,other@example.com\n' >> "$OGM_ENV_DIR/api.env"
set +e
"$signin" > /dev/null 2> "$scratch/err"
rc=$?
set -e
assert_eq 65 "$rc" 'no database exits 65'
assert_grep 'no database' "$scratch/err"
[[ ! -e $HOME/.config/ogm/qa/storage.json ]] || fail 'a refused run wrote a storage state'

if ! node -e "require('$repo/packages/gm-verify/node_modules/playwright').chromium.executablePath()" > /dev/null 2>&1 ||
  [[ ! -x $(node -p "require('$repo/packages/gm-verify/node_modules/playwright').chromium.executablePath()") ]]; then
  printf 'qa-signin: SKIP the signed-in run: no Playwright Chromium (pnpm --dir packages/gm-verify exec playwright install chromium)\n'
  exit 0
fi

# The fake app: the magic-link request writes the link (and a stale invitation from before) into mail_outbox, the
# link sets the session cookie, /api/v1/me answers for it, and accepting the invitation puts the account in a family.
cat > "$scratch/server.mjs" << 'SERVER'
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [repo, dbPath, portFile, logFile] = process.argv.slice(2);
const Database = createRequire(`${repo}/packages/db/package.json`)('better-sqlite3');
const db = new Database(dbPath);
db.exec('CREATE TABLE mail_outbox (id TEXT, "to" TEXT, subject TEXT, text TEXT, html TEXT, created_at TEXT, opened_at TEXT)');
const mail = (to, text, at = new Date().toISOString()) =>
  db.prepare('INSERT INTO mail_outbox VALUES (?, ?, ?, ?, NULL, ?, NULL)').run(`m_${Math.random()}`, to, 's', text, at);
let family = null;
const log = [];
const server = createServer((req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signedIn = (req.headers.cookie ?? '').includes('better-auth.session_token=qa-session');
  log.push(`${req.method} ${req.url.split('?')[0]}`);
  writeFileSync(logFile, log.join('\n') + '\n');
  if (req.method === 'POST' && req.url === '/auth/sign-in/magic-link') {
    mail('qa@example.com', `Open this invitation before it expires: ${origin}/join/inv_token`, '2026-01-01T00:00:00.000Z');
    mail('qa@example.com', `Open this link to sign in:\n\n${origin}/auth/magic-link/verify?token=t1&callbackURL=${origin}/\n`);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":true}');
  } else if (req.url.startsWith('/auth/magic-link/verify?token=t1')) {
    res.writeHead(302, { 'set-cookie': 'better-auth.session_token=qa-session; Path=/; HttpOnly', location: '/' }).end();
  } else if (req.url === '/api/v1/me' && signedIn) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ user: { id: 'u_qa', email: 'qa@example.com' }, family }));
  } else if (req.method === 'POST' && req.url === '/api/v1/invites/inv_token/accept' && signedIn) {
    family = { id: 'f_1', name: 'Weaver QA' };
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"kind":"member"}');
  } else if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<p>home</p>');
  } else {
    res.writeHead(401).end();
  }
});
server.listen(0, '127.0.0.1', () => writeFileSync(portFile, String(server.address().port)));
SERVER
node "$scratch/server.mjs" "$repo" "$scratch/data/ogm.sqlite3" "$scratch/port" "$scratch/requests" > /dev/null 2>&1 &
server_pid=$!
for _ in $(seq 50); do [[ -s $scratch/port ]] && break; sleep 0.1; done
origin=http://127.0.0.1:$(cat "$scratch/port")
printf 'OGM_APP_ORIGIN=%s\nOGM_DATA_DIR=%s\nOGM_QA_EMAILS=QA@example.com,other@example.com\n' "$origin" "$scratch/data" \
  > "$OGM_ENV_DIR/api.env"

"$signin" > "$scratch/out" 2>&1 || {
  cat "$scratch/out" >&2
  fail 'ogm-qa-signin failed against the fake app'
}
state=$HOME/.config/ogm/qa/storage.json
assert_eq 600 "$(stat -c %a "$state")" 'storage state is mode 600'
assert_eq 700 "$(stat -c %a "$(dirname "$state")")" 'its directory is mode 700'
assert_grep '"value": "qa-session"' "$state"
assert_grep 'invitation accepted' "$scratch/out"
assert_grep 'family: Weaver QA' "$scratch/out"
assert_not_grep 'qa-session' "$scratch/out"

# Signed in again with a family: the invitation is left alone.
"$signin" > "$scratch/out" 2>&1 || fail 'second run failed'
assert_not_grep 'invitation' "$scratch/out"
assert_eq 1 "$(grep -c 'POST /api/v1/invites/inv_token/accept' "$scratch/requests")" 'the invitation is accepted once'

printf 'qa-signin: ok\n'
