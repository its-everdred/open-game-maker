#!/usr/bin/env bash
# ogm-publish against a fake API and a scratch instance checkout: the script builds games/<slug> at a SHA, appends the
# relative base and published mode, archives dist/ with the manifest and the base design and posts it to the route.

set -euo pipefail

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$test_dir" rev-parse --show-toplevel)
source "$test_dir/lib.sh"

scratch=$(mktemp -d)
server_pid=
trap '[[ -n $server_pid ]] && kill $server_pid 2> /dev/null; rm -rf -- "$scratch"' EXIT

export HOME=$scratch/home
export OGM_ENV_DIR=$HOME/.config/ogm/env
mkdir -p "$OGM_ENV_DIR" "$scratch/bin" "$scratch/assets-local"
printf 'OGM_API_PORT=1\nOGM_INTERNAL_TOKEN=internal-token-for-publish-tests\nOGM_ASSETS_ROOT=%s/assets-local\n' "$scratch" \
  > "$OGM_ENV_DIR/api.env"

publish=$repo/ops/bin/ogm-publish

# A registered game's repository: games/blobs at one commit, built by a script that records the flags it was given.
checkout=$scratch/checkout
mkdir -p "$checkout/games/blobs"
git -C "$checkout" init -q -b main
git -C "$checkout" config user.email t@t
git -C "$checkout" config user.name t
cat > "$checkout/games/blobs/build.sh" << 'BUILD'
set -eu
printf '%s\n' "$*" > "$BUILD_ARGS_LOG"
mkdir -p dist/design dist/assets
printf '<!doctype html><script type="module" src="./assets/main.js"></script>\n' > dist/index.html
printf 'console.log("blobs")\n' > dist/assets/main.js
printf '{"id":"blobs","sdk":"1.0.0"}\n' > dist/manifest.json
printf '{"schemaVersion":1,"globals":{},"entities":{}}\n' > dist/design/design.json
printf '{"version":1,"packs":[]}\n' > dist/credits.json
BUILD
printf '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh"}}\n' > "$checkout/games/blobs/package.json"
printf 'node_modules/\ndist/\n' > "$checkout/.gitignore"
git -C "$checkout" add -A
git -C "$checkout" commit -qm "blobs"
sha=$(git -C "$checkout" rev-parse HEAD)
# The script's default ref is the checkout's origin/main, which a scratch repository has to name itself.
git -C "$checkout" update-ref refs/remotes/origin/main "$sha"

# The API's two answers: the game's facts and the upload's verdict. Every request is logged so the test can check the
# headers the script sends.
cat > "$scratch/server.mjs" << 'SERVER'
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [portFile, logFile, bodyFile, checkout] = process.argv.slice(2);
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    appendFileSync(
      logFile,
      `${request.method} ${request.url} token=${request.headers['x-ogm-internal'] ?? ''} sha=${request.headers['x-gm-sha'] ?? ''}\n`,
    );
    if (request.headers['x-ogm-internal'] !== 'internal-token-for-publish-tests') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"error":{"code":"unauthenticated"}}');
      return;
    }
    if (request.method === 'GET' && request.url === '/internal/operator/games/blobs') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          game: {
            id: 'g_blobs',
            slug: 'blobs',
            title: 'Blobs',
            repo: { owner: 'open', name: 'games', path: 'games/blobs' },
          },
          daemon: {
            port: 4011,
            checkoutPath: checkout,
            unit: 'ogm-aiur@blobs.service',
            envFile: 'blobs.env',
            status: 'running',
          },
          branch: { id: 'b_main', name: 'main', latestBuildId: null },
          build: null,
        }),
      );
      return;
    }
    if (request.method === 'POST' && request.url === '/internal/operator/games/blobs/builds') {
      writeFileSync(bodyFile, Buffer.concat(chunks));
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end('{"state":"done","jobId":"j_publish","buildId":"build_publish"}');
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":{"code":"not_found"}}');
  });
});
server.listen(0, '127.0.0.1', () => writeFileSync(portFile, String(server.address().port)));
SERVER

port_file=$scratch/port
log=$scratch/requests.log
body=$scratch/upload.tgz
node "$scratch/server.mjs" "$port_file" "$log" "$body" "$checkout" &
server_pid=$!
for _ in $(seq 1 100); do [[ -s $port_file ]] && break; sleep 0.1; done
[[ -s $port_file ]] || fail "the fake API did not start"
port=$(cat "$port_file")

export BUILD_ARGS_LOG=$scratch/build-args
export PNPM_LOG=$scratch/pnpm.log
export OGM_PUBLISH_WORK_ROOT=$scratch/work
export PATH=$scratch/bin:$PATH
# A fake pnpm: the scratch checkout has no workspace install to do, and the game's build script is one shell script.
cat > "$scratch/bin/pnpm" << 'PNPM'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$PNPM_LOG"
[[ ${1:-} == install ]] && exit 0
[[ ${1:-} == run ]] && shift
[[ ${1:-} == build ]] && shift
[[ ${1:-} == -- ]] && shift
exec sh -c "$(node -p 'require("./package.json").scripts.build') $*"
PNPM
chmod +x "$scratch/bin/pnpm"

"$publish" blobs --api "http://127.0.0.1:$port" > "$scratch/out.txt" 2> "$scratch/err.txt" ||
  fail "ogm-publish failed: $(cat "$scratch/err.txt")"
assert_grep "building games/blobs at $sha" "$scratch/out.txt"
assert_grep "published games/blobs at $sha" "$scratch/out.txt"
assert_grep "GET /internal/operator/games/blobs token=internal-token-for-publish-tests sha=" "$log"
assert_grep "POST /internal/operator/games/blobs/builds token=internal-token-for-publish-tests sha=$sha" "$log"
assert_grep 'install --frozen-lockfile' "$PNPM_LOG"
assert_grep 'build -- --base=./ --mode=published' "$PNPM_LOG"
assert_eq '--base=./ --mode=published' "$(cat "$BUILD_ARGS_LOG")" 'the build runs with a relative base in published mode'
listing=$(tar -tzf "$body")
for entry in ./index.html ./manifest.json ./design/design.json ./credits.json; do
  grep -Fq -- "$entry" <<< "$listing" || fail "the upload is missing $entry"
done
assert_not_grep 'internal-token-for-publish-tests' "$scratch/out.txt"

# The script's own refusals: bad usage, a game the API does not know, a checkout that is not there, no token.
"$publish" > /dev/null 2>&1 && fail "ogm-publish without a slug should exit 64" || assert_eq 64 "$?" 'usage exit'
"$publish" nope --api "http://127.0.0.1:$port" > /dev/null 2>&1 && fail "an unknown game should fail" ||
  assert_eq 65 "$?" 'unknown game exit'
"$publish" blobs --api "http://127.0.0.1:$port" --checkout "$scratch/missing" > /dev/null 2>&1 &&
  fail "a missing checkout should fail" || assert_eq 65 "$?" 'checkout exit'
mkdir -p "$scratch/noenv"
OGM_ENV_DIR=$scratch/noenv OGM_INTERNAL_TOKEN= "$publish" blobs --api "http://127.0.0.1:$port" > /dev/null 2>&1 &&
  fail "a missing token should fail" || assert_eq 65 "$?" 'token exit'

printf 'ok\n'
