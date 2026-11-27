#!/usr/bin/env bash
set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"
scratch=$(mktemp -d)
server_pid=
trap '[[ -n $server_pid ]] && kill "$server_pid" 2> /dev/null; rm -rf -- "$scratch"' EXIT
export OGM_ENV_DIR=$scratch/env
mkdir -p "$OGM_ENV_DIR"
cat > "$scratch/server.mjs" <<'NODE'
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const [log, mode] = process.argv.slice(2);
const id = '12345678-1234-4234-8234-123456789abc';
createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', () => {
    appendFileSync(log, `${req.method} ${req.url}\n`);
    res.setHeader('content-type', 'application/json');
    if (req.headers['x-ogm-internal'] !== 'test-token') { res.statusCode = 401; return res.end('{}'); }
    if (req.url === '/internal/qa/session') return res.end(JSON.stringify({ gameId: 'g_qa', cookie: { name: 'qa', value: 'test-cookie' } }));
    if (req.url === '/internal/qa/energy-budget/begin') return res.end(JSON.stringify({ id }));
    if (req.url === '/internal/qa/energy-budget/end') { res.statusCode = 204; return res.end(); }
    if (req.url === '/internal/qa/energy-budget') return res.end(JSON.stringify({ active: { id } }));
    if (req.url === '/api/v1/game-drafts' && mode === 'fail') { res.statusCode = 409; return res.end('{}'); }
    if (req.url === '/api/v1/reports') { res.statusCode = 201; return res.end(JSON.stringify({ pendingBudget: true, budgetReason: 'weekly_user', resetsAt: '2026-11-30T08:00:00Z' })); }
    res.statusCode = 402;
    res.end(JSON.stringify({ reason: 'weekly_user', window: 'week', resetsAt: '2026-11-30T08:00:00Z' }));
  });
}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });
NODE
start_server() {
  : > "$scratch/requests"
  : > "$scratch/port"
  node "$scratch/server.mjs" "$scratch/requests" "$1" > "$scratch/port" &
  server_pid=$!
  for _ in $(seq 50); do [[ -s $scratch/port ]] && break; sleep 0.1; done
  printf 'OGM_API_PORT=%s\nOGM_INTERNAL_TOKEN=test-token\n' "$(cat "$scratch/port")" > "$OGM_ENV_DIR/api.env"
  printf 'OGM_QA_EMAIL=qa@example.test\n' > "$OGM_ENV_DIR/qa.env"
}
start_server fail
set +e
"$repo/ops/bin/qa-energy-budget" > "$scratch/out" 2> "$scratch/err"
rc=$?
set -e
assert_eq 1 "$rc" 'failed refusal exits nonzero'
assert_grep 'POST /internal/qa/energy-budget/end' "$scratch/requests"
assert_not_grep 'test-token' "$scratch/out"
assert_not_grep 'test-cookie' "$scratch/err"
kill "$server_pid"
start_server pass
"$repo/ops/bin/qa-energy-budget" > "$scratch/out" 2> "$scratch/err"
assert_grep 'POST /api/v1/game-drafts' "$scratch/requests"
assert_grep 'POST /api/v1/jobs' "$scratch/requests"
assert_grep 'POST /api/v1/reports' "$scratch/requests"
assert_grep 'POST /internal/qa/energy-budget/end' "$scratch/requests"
"$repo/ops/bin/qa-energy-budget" --recover > /dev/null
assert_grep 'GET /internal/qa/energy-budget' "$scratch/requests"
printf '%s\n' 'qa-energy-budget: ok'
