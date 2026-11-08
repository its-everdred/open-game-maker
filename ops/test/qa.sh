#!/usr/bin/env bash
# ogm-qa against a fake API and a fake gm: the script resolves the game's newest build to its games-origin URL and runs
# open, a drive per solo journey, a room per room journey, look and the report from the game's folder, in that order.

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
printf 'OGM_API_PORT=1\nOGM_INTERNAL_TOKEN=internal-token-for-qa-tests\n' > "$OGM_ENV_DIR/api.env"
printf 'OGM_GAMES_ORIGIN=https://games.example:10000\n' > "$OGM_ENV_DIR/games.env"

qa=$repo/ops/bin/ogm-qa

checkout=$scratch/checkout
journeys=$checkout/games/blobs/qa/journeys
mkdir -p "$journeys"
printf '{"name":"solo-cpu","steps":[{"do":"click","text":"Versus CPU"}]}\n' > "$journeys/solo-cpu.json"
printf '{"name":"online-2p","kind":"room"}\n' > "$journeys/online-2p.json"

# The facts route: blobs has a newest build, empty has none.
cat > "$scratch/server.mjs" << 'SERVER'
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [portFile, checkout] = process.argv.slice(2);
const facts = (slug, latestBuildId) => ({
  game: { id: `g_${slug}`, slug, title: slug, repo: { owner: 'open', name: 'games', path: `games/${slug}` } },
  daemon: { port: 4011, checkoutPath: checkout, unit: 'u', envFile: 'e', status: 'running' },
  branch: { id: 'b_main', name: 'main', latestBuildId },
  build: null,
});
const server = createServer((request, response) => {
  const ok = request.headers['x-ogm-internal'] === 'internal-token-for-qa-tests';
  const body =
    request.url === '/internal/operator/games/blobs' ? facts('blobs', 'build_new')
    : request.url === '/internal/operator/games/empty' ? facts('empty', null)
    : null;
  response.writeHead(ok && body ? 200 : ok ? 404 : 401, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body ?? { error: { code: ok ? 'game_not_found' : 'unauthenticated' } }));
});
server.listen(0, '127.0.0.1', () => writeFileSync(portFile, String(server.address().port)));
SERVER

port_file=$scratch/port
node "$scratch/server.mjs" "$port_file" "$checkout" &
server_pid=$!
for _ in $(seq 1 100); do [[ -s $port_file ]] && break; sleep 0.1; done
[[ -s $port_file ]] || fail "the fake API did not start"
api=http://127.0.0.1:$(cat "$port_file")

# A fake gm that logs where it ran and what it was asked, and fails the drive when GM_FAIL_DRIVE is set.
cat > "$scratch/gm" << 'GM'
#!/usr/bin/env bash
printf '%s | %s\n' "$PWD" "$*" >> "$GM_LOG"
[[ -n ${GM_FAIL_DRIVE:-} && $2 == drive ]] && exit 1
exit 0
GM
chmod +x "$scratch/gm"
export OGM_GM=$scratch/gm
export GM_LOG=$scratch/gm.log

"$qa" blobs --api "$api" --clients 3 > "$scratch/out.txt" 2> "$scratch/err.txt" ||
  fail "ogm-qa failed: $(cat "$scratch/err.txt")"
url=https://games.example:10000/g/g_blobs/build_new/
run=$HOME/.local/state/ogm/qa/blobs/build_new
game=$checkout/games/blobs
expected="$game | qa open --url $url --out $run
$game | qa room --url $url --journey $journeys/online-2p.json --clients 3 --out $run
$game | qa drive --url $url --journey $journeys/solo-cpu.json --out $run
$game | qa look --out $run
$game | qa look --report --out $run"
assert_eq "$expected" "$(cat "$GM_LOG")" 'open, one command per journey by kind, look, then the report, from the game folder'
assert_grep "report $run/qa-report.md" "$scratch/out.txt"
assert_not_grep 'internal-token-for-qa-tests' "$scratch/out.txt"

# A failed step still runs the rest, so the report covers everything, and the run exits 1.
: > "$GM_LOG"
GM_FAIL_DRIVE=1 "$qa" blobs --api "$api" --build build_old --out "$scratch/run" > /dev/null 2>&1 &&
  fail "a failed drive should fail the run" || assert_eq 1 "$?" 'failed step exit'
assert_eq 5 "$(wc -l < "$GM_LOG" | tr -d ' ')" 'every step ran after the failure'
assert_grep "qa open --url https://games.example:10000/g/g_blobs/build_old/ --out $scratch/run" "$GM_LOG"

# Refusals: bad usage, a game with no build, an unknown game, no token, no origin.
"$qa" > /dev/null 2>&1 && fail "ogm-qa without a slug should exit 64" || assert_eq 64 "$?" 'usage exit'
"$qa" blobs --clients 5 > /dev/null 2>&1 && fail "five clients should exit 64" || assert_eq 64 "$?" 'clients exit'
"$qa" empty --api "$api" > /dev/null 2> "$scratch/err.txt" && fail "a game with no build should fail" ||
  assert_eq 65 "$?" 'no build exit'
assert_grep 'has no build on main yet' "$scratch/err.txt"
"$qa" nope --api "$api" > /dev/null 2>&1 && fail "an unknown game should fail" || assert_eq 65 "$?" 'unknown game exit'
mkdir -p "$scratch/noenv"
OGM_ENV_DIR=$scratch/noenv OGM_INTERNAL_TOKEN= "$qa" blobs --api "$api" > /dev/null 2>&1 &&
  fail "a missing token should fail" || assert_eq 65 "$?" 'token exit'
printf 'OGM_INTERNAL_TOKEN=internal-token-for-qa-tests\n' > "$scratch/noenv/api.env"
OGM_ENV_DIR=$scratch/noenv "$qa" blobs --api "$api" > /dev/null 2>&1 &&
  fail "a missing games origin should fail" || assert_eq 65 "$?" 'origin exit'

printf 'ok\n'
