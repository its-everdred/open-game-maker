import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { gm, tempDir } from './helpers.js';
import { ReviewSubmission } from '@ogm/contracts';

const TOKEN = 'internal-token-for-publish-tests';

type Logged = { method: string; url: string; token: string; sha: string; body: Buffer };

let server: Server;
let api: string;
let requests: Logged[] = [];
let checkRecords: unknown[] = [];
let uploadAnswer: { status: number; body: string } = { status: 201, body: '' };
// Uploads still to drop by closing the connection without an answer, as a reset keep-alive socket does.
let dropUploads = 0;
// Uploads to answer with headers and then cut off mid-body, after the API has acted on them.
let breakUploads = 0;
let root: string;
let origin: string;
let checkout: string;
let bin: string;
let staleSha: string;
let remoteSha: string;
let brokenSha: string;
let unlistedSha: string;
let slowSha: string;
let failingTestSha: string;
let smokeTestSha: string;
let wrongServeSha: string;
let mutatingSmokeSha: string;
let mutationSha: string;
let sourceMutationSha: string;
let untrackedMutationSha: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
}

/* A game folder whose build script records the flags and the environment it ran with, and writes a publishable dist/. */
function writeGame(repo: string, marker: string): void {
  const game = join(repo, 'games', 'blobs');
  mkdirSync(join(game, 'design'), { recursive: true });
  writeFileSync(
    join(game, 'build.sh'),
    [
      'set -eu',
      'if [[ -n ${ASSET_CACHE_SENTINEL:-} ]]; then test ! -e .gm/cache/assets/sentinel; fi',
      'printf "%s\\n" "$*" > "$BUILD_ARGS_LOG"',
      'printf "token=%s github=%s mode=%s assets=%s\\n" "${OGM_INTERNAL_TOKEN:-}" "${GITHUB_TOKEN:-}" "$NODE_ENV" "${OGM_ASSETS_ROOT:-}" > "$BUILD_ENV_LOG"',
      'mkdir -p dist/design dist/assets',
      `printf '<!doctype html><script type="module" src="./assets/main.js"></script><!-- ${marker} -->\\n' > dist/index.html`,
      'printf "console.log(1)\\n" > dist/assets/main.js',
      `printf '{"id":"blobs","sdk":"1.0.0"}\\n' > dist/manifest.json`,
      `printf '{"schemaVersion":1,"globals":{},"entities":{}}\\n' > dist/design/design.json`,
      `printf '{"version":1,"packs":[]}\\n' > dist/credits.json`,
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(game, 'package.json'),
    '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh","test":"test -f dist/index.html"}}\n',
  );
  writeFileSync(join(game, 'gm.manifest.json'), '{"id":"blobs","capabilities":[]}\n');
  writeFileSync(join(game, 'manifest.json'), '{"id":"blobs","sdk":"1.0.0"}\n');
  writeFileSync(join(game, 'design', 'design.json'), '{"schemaVersion":1,"globals":{},"entities":{}}\n');
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\ndist/\n');
}

beforeAll(async () => {
  root = tempDir('gm-publish-');
  // The instance repository's origin, a checkout that fetched it once, and origin's main moving on after that.
  origin = join(root, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  writeGame(origin, 'old');
  mkdirSync(join(origin, 'docs', 'blobs'), { recursive: true });
  writeFileSync(
    join(origin, 'docs', 'blobs', 'decisions.json'),
    JSON.stringify([
      { id: 'enemies-first', status: 'open' },
      { id: 'loot-drop', status: 'asked' },
      { id: 'town-shop', status: 'open' },
    ]),
  );
  git(origin, 'add', '-A');
  git(origin, 'commit', '-qm', 'old');
  staleSha = git(origin, 'rev-parse', 'HEAD');
  checkout = join(root, 'checkout');
  execFileSync('git', ['clone', '-q', origin, checkout]);
  writeGame(origin, 'new');
  git(origin, 'commit', '-qam', 'new (#42)');
  remoteSha = git(origin, 'rev-parse', 'HEAD');
  // A commit only origin has, on a side branch, whose build fails.
  git(origin, 'switch', '-qc', 'broken');
  writeFileSync(join(origin, 'games', 'blobs', 'build.sh'), 'echo "vite: cannot resolve ./src/main.ts" >&2\nexit 3\n');
  git(origin, 'commit', '-qam', 'broken');
  brokenSha = git(origin, 'rev-parse', 'HEAD');
  // A commit whose code names an asset its list does not hold.
  git(origin, 'switch', '-qc', 'unlisted', 'main');
  mkdirSync(join(origin, 'games', 'blobs', 'src'));
  writeFileSync(join(origin, 'games', 'blobs', 'src', 'main.ts'), "load('t1:kenney-mini-dungeon/wall@2.0');\n");
  git(origin, 'add', '-A');
  git(origin, 'commit', '-qm', 'unlisted');
  unlistedSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-qc', 'slow', 'main');
  writeFileSync(join(origin, 'games', 'blobs', 'build.sh'), 'sleep 2\n');
  git(origin, 'commit', '-qam', 'slow build fixture');
  slowSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-qc', 'failing-test', 'main');
  writeFileSync(
    join(origin, 'games', 'blobs', 'package.json'),
    '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh","test":"exit 7"}}\n',
  );
  git(origin, 'commit', '-qam', 'failing test fixture');
  failingTestSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-qc', 'smoke-test', 'main');
  writeFileSync(
    join(origin, 'games', 'blobs', 'package.json'),
    '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh","test":"gm test"}}\n',
  );
  git(origin, 'commit', '-qam', 'smoke test fixture');
  smokeTestSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-qc', 'mutating-smoke', 'smoke-test');
  writeFileSync(join(origin, 'games', 'blobs', '.mutate-test'), 'yes');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-qm', 'mutating smoke fixture');
  mutatingSmokeSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-qc', 'wrong-serve', 'main');
  writeFileSync(
    join(origin, 'games', 'blobs', 'package.json'),
    '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh","test":"gm test --serve old-dist"}}\n',
  );
  git(origin, 'commit', '-qam', 'wrong serve fixture');
  wrongServeSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-qc', 'mutating-test', 'main');
  writeFileSync(
    join(origin, 'games', 'blobs', 'package.json'),
    '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh","test":"printf changed > dist/index.html"}}\n',
  );
  git(origin, 'commit', '-qam', 'mutating test fixture');
  mutationSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-qc', 'mutating-source', 'main');
  writeFileSync(
    join(origin, 'games', 'blobs', 'package.json'),
    '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh","test":"printf changed > manifest.json"}}\n',
  );
  git(origin, 'commit', '-qam', 'mutating source fixture');
  sourceMutationSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-qc', 'untracked-source', 'main');
  writeFileSync(
    join(origin, 'games', 'blobs', 'package.json'),
    '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh","test":"printf generated > generated.ts"}}\n',
  );
  git(origin, 'commit', '-qam', 'untracked source fixture');
  untrackedMutationSha = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'switch', '-q', 'main');

  // pnpm stand-in: the scratch repository has nothing to install, and its build is one shell script.
  bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'pnpm'),
    [
      '#!/usr/bin/env bash',
      'set -eu',
      'printf "%s\\n" "$*" >> "$PNPM_LOG"',
      '[[ ${1:-} == install ]] && exit 0',
      'if [[ ${1:-} == exec ]]; then touch dist/.test-mode; exit 0; fi',
      '[[ ${1:-} == run ]] && shift',
      'if [[ ${1:-} == test ]] && [[ "$(node -p \'require("./package.json").scripts.test\')" == "gm test" ]]; then test -f dist/.test-mode; if [[ -f .mutate-test ]]; then printf changed > dist/index.html; fi; exit; fi',
      'if [[ ${1:-} == test ]]; then exec sh -c "$(node -p \'require("./package.json").scripts.test\')"; fi',
      '[[ ${1:-} == build ]] && shift',
      '[[ ${1:-} == -- ]] && shift',
      'exec sh -c "$(node -p \'require("./package.json").scripts.build\') $*"',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'pnpm'), 0o755);
  writeFileSync(join(bin, 'codex'), '#!/usr/bin/env bash\nwhile [[ "$1" != -- ]]; do shift; done\nshift\nexec "$@"\n');
  chmodSync(join(bin, 'codex'), 0o755);
  writeFileSync(
    join(bin, 'gh'),
    '#!/usr/bin/env bash\nif [[ ${GH_FAIL_PR:-} == "${3:-}" ]]; then exit 1; fi\nif [[ ${GH_NONE_PR:-} == "${3:-}" ]]; then printf "%s\\n" "Prototype review: none"; exit 0; fi\nprintf "%s\\n" "Closes #42" "## Prototype review" "**Works now:** walk around" "**Known limitations:** no attack yet" "**Weigh in on:** enemies-first, loot-drop, town-shop"\nif [[ -n ${GH_PLAY:-} ]]; then printf "Play: %s\\n" "$GH_PLAY"; fi\n',
  );
  chmodSync(join(bin, 'gh'), 0o755);

  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/internal/operator/games/blobs/publish-checks') {
        checkRecords.push(JSON.parse(Buffer.concat(chunks).toString()));
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end('{"id":"pc_test","result":"passed"}');
        return;
      }
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        token: String(request.headers['x-ogm-internal'] ?? ''),
        sha: String(request.headers['x-gm-sha'] ?? ''),
        body: Buffer.concat(chunks),
      });
      const json = (status: number, body: string) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(body);
      };
      if (request.headers['x-ogm-internal'] !== TOKEN) return json(401, '{"error":{"code":"unauthenticated"}}');
      if (request.method === 'GET' && request.url === '/internal/operator/games/blobs') {
        return json(
          200,
          JSON.stringify({
            game: {
              id: 'g_blobs',
              slug: 'blobs',
              title: 'Blobs',
              repo: { owner: 'o', name: 'games', path: 'games/blobs' },
            },
            daemon: { port: 4011, checkoutPath: checkout, unit: 'ogm-aiur@blobs.service', status: 'running' },
            branch: { id: 'b_main', name: 'main', latestBuildId: null },
            build: null,
          }),
        );
      }
      if (
        request.method === 'GET' &&
        request.url?.match(/^\/internal\/operator\/games\/blobs\/review-sha\/[0-9a-f]{40}$/)
      )
        return json(200, '{"recorded":false}');
      if (request.method === 'GET' && request.url?.startsWith('/internal/operator/games/blobs/builds/')) {
        return json(200, JSON.stringify({ state: 'failed', buildId: null }));
      }
      if (request.method === 'POST' && request.url === '/internal/operator/games/blobs/builds') {
        if (dropUploads > 0) {
          dropUploads -= 1;
          return request.socket.destroy();
        }
        if (breakUploads > 0) {
          breakUploads -= 1;
          response.writeHead(201, { 'content-type': 'application/json', 'content-length': '100' });
          response.write('{"state":');
          return setTimeout(() => request.socket.destroy(), 20);
        }
        const answer = JSON.parse(uploadAnswer.body) as Record<string, unknown>;
        if (uploadAnswer.status === 201 && answer.publishResult === undefined) answer.publishResult = 'published';
        return json(uploadAnswer.status, JSON.stringify(answer));
      }
      if (
        request.method === 'POST' &&
        request.url?.match(/^\/internal\/operator\/games\/blobs\/builds\/[^/]+\/access$/)
      )
        return json(200, JSON.stringify({ url: 'https://games.example/d/g_blobs/build/secret/' }));
      if (request.method === 'POST' && request.url === '/internal/operator/games/blobs/prototype-reviews')
        return json(201, '{"id":"review-1","round":1,"state":"posted"}');
      if (request.method === 'GET' && request.url?.includes('/prototype-review'))
        return json(200, '{"recorded":true,"roundId":"review-1","round":1}');
      return json(404, '{"error":{"code":"game_not_found"}}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
});

function hostHome(
  apiEnv = `OGM_INTERNAL_TOKEN=${TOKEN}\nOGM_API_PORT=1\nOGM_APP_ORIGIN=https://play.example\nOGM_GAMES_ORIGIN=https://games.example\n`,
): string {
  const home = tempDir('gm-publish-home-');
  mkdirSync(join(home, '.config', 'ogm', 'env'), { recursive: true });
  writeFileSync(join(home, '.config', 'ogm', 'env', 'api.env'), apiEnv);
  return home;
}

async function publish(argv: string[], options: { home?: string; cwd?: string; env?: Record<string, string> } = {}) {
  const logs = tempDir('gm-publish-logs-');
  const home = options.home ?? hostHome();
  const env = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    PNPM_LOG: join(logs, 'pnpm'),
    BUILD_ARGS_LOG: join(logs, 'args'),
    BUILD_ENV_LOG: join(logs, 'env'),
    OGM_ASSETS_ROOT: join(root, 'assets-local'),
    OGM_QA_GM: 'true',
    OGM_QA_GAME_BOOT: 'true',
    OGM_QA_GAME_PLAY: 'true',
    GITHUB_TOKEN: 'test-token',
    ...options.env,
  };
  requests = [];
  checkRecords = [];
  const result = await gm(['publish', ...argv], { home, env, ...(options.cwd ? { cwd: options.cwd } : {}) });
  const read = (name: string) => (existsSync(join(logs, name)) ? readFileSync(join(logs, name), 'utf8') : '');
  return { ...result, home, pnpm: read('pnpm'), args: read('args'), buildEnv: read('env') };
}

describe('gm publish', () => {
  it("builds the repository's remote main, not the checkout's stale origin/main, and prints the build and play link", async () => {
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_publish","buildId":"build_publish"}' };
    expect(git(checkout, 'rev-parse', 'origin/main')).toBe(staleSha);

    // The token in the environment reaches the API and never the build.
    const run = await publish(['blobs', '--api', api], { env: { OGM_INTERNAL_TOKEN: TOKEN, GITHUB_TOKEN: 'private' } });

    expect(run.err).toEqual([]);
    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      `building games/blobs at ${remoteSha}`,
      `published games/blobs at ${remoteSha}: build build_publish`,
      'play https://play.example/g/g_blobs?build=build_publish',
    ]);
    const upload = requests.find((r) => r.method === 'POST')!;
    expect(upload).toMatchObject({ url: '/internal/operator/games/blobs/builds', token: TOKEN, sha: remoteSha });
    expect(requests.some((r) => r.url.endsWith('/builds/build_publish/access') && r.token === TOKEN)).toBe(true);
    const review = requests.find((r) => r.url.endsWith('/prototype-reviews'))!;
    expect(JSON.parse(review.body.toString())).toMatchObject({
      track: 'prototype-publish',
      sourceTickets: ['42'],
      works: ['walk around'],
      limitations: ['no attack yet'],
      decisionIds: ['loot-drop', 'enemies-first', 'town-shop'],
      clipStatus: 'unchecked',
      media: [{ kind: 'build', ref: 'build_publish' }],
    });
    expect(ReviewSubmission.safeParse(JSON.parse(review.body.toString())).success).toBe(true);
    // The production build: relative base, published mode, the asset library, and never the operator's token.
    expect(run.pnpm).toContain('install --frozen-lockfile');
    expect(run.pnpm).toContain('run test');
    expect(checkRecords).toContainEqual({
      gitSha: remoteSha,
      artifactSha256: createHash('sha256').update(upload.body).digest('hex'),
      surface: 'game',
      sizes: [],
      checks: [
        { name: 'asset references', result: 'passed' },
        { name: 'asset rights and files', result: 'passed' },
        { name: 'dependency install', result: 'passed' },
        { name: 'pnpm run build', result: 'passed' },
        { name: 'production snapshot', result: 'passed' },
        { name: 'pnpm run test', result: 'passed' },
        { name: 'source integrity', result: 'passed' },
        { name: 'production build integrity', result: 'passed' },
        { name: 'publish artifact', result: 'passed' },
      ],
    });
    expect(run.args.trim()).toBe('--base=./ --mode=published');
    expect(run.buildEnv.trim()).toMatch(/token= github= mode=production assets=.*\/assets$/);
    const archive = join(tempDir('gm-publish-archive-'), 'upload.tgz');
    writeFileSync(archive, upload.body);
    const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    for (const entry of ['./index.html', './manifest.json', './design/design.json', './credits.json']) {
      expect(listing).toContain(entry);
    }
    expect(execFileSync('tar', ['-xzOf', archive, './index.html'], { encoding: 'utf8' })).toContain('<!-- new -->');
    expect(run.out.join('\n')).not.toContain(TOKEN);
    // The scratch worktree and the archive are gone.
    expect(readdirSync(join(run.home, '.local', 'state', 'ogm', 'publish'))).toEqual([]);
    expect(git(checkout, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('does not expose old asset cache files to the publish build', async () => {
    const cache = join(checkout, 'games', 'blobs', '.gm', 'cache', 'assets');
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, 'sentinel'), 'reusable cache');
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_cache","buildId":"build_cache"}' };

    const run = await publish(['blobs', '--sha', staleSha, '--api', api], {
      env: { OGM_INTERNAL_TOKEN: TOKEN, ASSET_CACHE_SENTINEL: 'reusable cache' },
    });

    expect(run.code).toBe(0);
    expect(run.err).toEqual([]);
    expect(readFileSync(join(cache, 'sentinel'), 'utf8')).toBe('reusable cache');
  });

  /* #1281: the published review card plays the slice the merged PR reviewed, so its scenario rides on the build. */
  it('carries the merged review Play link scenario onto the published build', async () => {
    git(origin, 'switch', '-q', 'main');
    git(origin, 'commit', '--allow-empty', '-qm', 'wave three slice (#44)');
    remoteSha = git(origin, 'rev-parse', 'HEAD');
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_slice","buildId":"build_slice"}' };
    const play = 'https://app.example/g/g_blobs?mode=edit&build=build_pr&scenario=endless%2Fwave-3';
    const run = await publish(['blobs', '--api', api], { env: { OGM_INTERNAL_TOKEN: TOKEN, GH_PLAY: play } });
    expect(run.code).toBe(0);
    const review = JSON.parse(requests.find((r) => r.url.endsWith('/prototype-reviews'))!.body.toString());
    expect(review.media[0]).toEqual({ kind: 'build', ref: 'build_slice', scenario: 'endless/wave-3' });
    expect(ReviewSubmission.safeParse(review).success).toBe(true);
  });

  it('posts fallback content and reports an attention when a merged PR body cannot be read', async () => {
    git(origin, 'switch', '-q', 'main');
    git(origin, 'commit', '--allow-empty', '-qm', 'prototype review: none (#42)');
    git(origin, 'commit', '--allow-empty', '-qm', 'follow-up (#43)');
    remoteSha = git(origin, 'rev-parse', 'HEAD');
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_missing_pr","buildId":"build_missing_pr"}' };
    const run = await publish(['blobs', '--api', api], {
      env: { OGM_INTERNAL_TOKEN: TOKEN, GH_FAIL_PR: '43', GH_NONE_PR: '42' },
    });

    expect(run.code).toBe(0);
    expect(run.err.join('\n')).toContain('could not read PR body');
    const review = requests.find((request) => request.url.endsWith('/prototype-reviews'))!;
    expect(JSON.parse(review.body.toString())).toMatchObject({
      track: 'prototype-publish',
      ticket: 'publish',
      works: [],
      limitations: ['Limitations not stated'],
    });
    expect(ReviewSubmission.safeParse(JSON.parse(review.body.toString())).success).toBe(true);
  });

  it('publishes an inventoried SHA and records its review after the build is available', async () => {
    git(origin, 'switch', '-qc', 'inventory', 'main');
    mkdirSync(join(origin, 'docs', 'blobs'), { recursive: true });
    writeFileSync(join(origin, 'docs', 'blobs', 'decisions.json'), '{"decisions":[]}\n');
    git(origin, 'add', '-A');
    git(origin, 'commit', '-qm', 'add decision inventory');
    const sha = git(origin, 'rev-parse', 'HEAD');

    const run = await publish(['blobs', '--sha', sha, '--api', api]);

    expect(run.code).toBe(0);
    const upload = requests.find(({ url }) => url.endsWith('/builds'))!;
    const review = requests.find(({ url }) => url.endsWith('/prototype-reviews'))!;
    expect(upload.sha).toBe(sha);
    expect(JSON.parse(review.body.toString())).toMatchObject({ sha });
  });

  it('defaults the slug to the game folder it runs in and builds an explicit --sha', async () => {
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_2","buildId":"build_2"}' };

    const run = await publish(['--sha', staleSha, '--api', api, '--json'], { cwd: join(checkout, 'games', 'blobs') });

    expect(run.code).toBe(0);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /internal/operator/games/blobs',
      'POST /internal/operator/games/blobs/builds',
      'POST /internal/operator/games/blobs/builds/build_2/prototype-review-check',
    ]);
    expect(requests[1]!.sha).toBe(staleSha);
    expect(run.out.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        state: 'done',
        slug: 'blobs',
        gameId: 'g_blobs',
        sha: staleSha,
        buildId: 'build_2',
        jobId: 'j_2',
        play: 'https://play.example/g/g_blobs?build=build_2',
        prototypeReview: { state: 'skipped' },
      },
    ]);
  });

  it('reads the API port from api.env and exits 1 when the API refuses the archive', async () => {
    uploadAnswer = { status: 422, body: '{"error":{"code":"manifest_invalid"}}' };
    const port = new URL(api).port;
    const home = hostHome(`OGM_INTERNAL_TOKEN=${TOKEN}\nOGM_API_PORT="${port}"\n`);

    const run = await publish(['blobs'], { home });

    expect(run.code).toBe(1);
    expect(run.err).toEqual([`not published (${remoteSha}): {"error":{"code":"manifest_invalid"}}`]);
  });

  // #646: the first upload after a long build failed with "fetch failed" and an immediate rerun published.
  it('sends the upload once more when the connection drops before an answer, and publishes', async () => {
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_3","buildId":"build_3"}' };
    dropUploads = 1;

    const run = await publish(['blobs', '--api', api]);

    expect(run.err).toEqual([]);
    expect(run.code).toBe(0);
    expect(run.out).toContain(`published games/blobs at ${remoteSha}: build build_3`);
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST', 'POST', 'POST']);
  });

  it('exits 1 naming the socket error when the upload drops twice, so a publish chain stops', async () => {
    dropUploads = 2;

    const run = await publish(['blobs', '--api', api]);

    expect(run.code).toBe(1);
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).toMatch(
      /^no answer from http:\/\/127\.0\.0\.1:\d+\/internal\/operator\/games\/blobs\/builds: fetch failed \(.+\)$/,
    );
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST', 'POST', 'GET']);
    expect(readdirSync(join(run.home, '.local', 'state', 'ogm', 'publish'))).toEqual([]);
  });

  it('does not send the upload again when its answer breaks off, as the API has already acted on it', async () => {
    breakUploads = 1;

    const run = await publish(['blobs', '--api', api]);

    expect(run.code).toBe(1);
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).toMatch(
      /^the answer from http:\/\/127\.0\.0\.1:\d+\/internal\/operator\/games\/blobs\/builds broke off \(HTTP 201\): /,
    );
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST', 'GET']);
  });

  it('reports a skipped automatic release without claiming it was published', async () => {
    uploadAnswer = {
      status: 201,
      body: '{"state":"done","jobId":"j_skipped","buildId":"build_skipped","publishResult":"skipped"}',
    };
    const run = await publish(['blobs', '--api', api]);
    expect(run.code).toBe(0);
    expect(run.out.join('\n')).toContain('automatic release skipped');
    expect(run.out.join('\n')).not.toContain('published games/');
    expect(requests.some((request) => request.url.endsWith('/prototype-reviews'))).toBe(false);
  });

  it('does not send the upload again when it times out, as the API may still be publishing it', async () => {
    const real = globalThis.fetch;
    let uploads = 0;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (init?.method !== 'POST' || !String(input).endsWith('/builds')) return real(input, init);
      uploads += 1;
      return Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    });
    try {
      const run = await publish(['blobs', '--api', api]);

      expect(run.code).toBe(1);
      expect(run.err).toEqual([
        expect.stringMatching(/\/internal\/operator\/games\/blobs\/builds: The operation was aborted due to timeout$/),
      ]);
      expect(uploads).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('fetches a --sha only origin has, exits 1 with the build output when the build fails, and cleans up', async () => {
    const run = await publish(['blobs', '--sha', brokenSha, '--api', api]);

    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain("the game's build failed");
    expect(run.err.join('\n')).toContain('vite: cannot resolve ./src/main.ts');
    expect(requests.map((r) => r.method)).toEqual(['GET']);
    expect(readdirSync(join(run.home, '.local', 'state', 'ogm', 'publish'))).toEqual([]);
    expect(git(checkout, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('does not upload when the game tests fail', async () => {
    const run = await publish(['blobs', '--sha', failingTestSha, '--api', api]);

    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain("the game's tests failed");
    expect(checkRecords).toContainEqual({
      gitSha: failingTestSha,
      surface: 'game',
      sizes: [],
      checks: [
        { name: 'asset references', result: 'passed' },
        { name: 'asset rights and files', result: 'passed' },
        { name: 'dependency install', result: 'passed' },
        { name: 'pnpm run build', result: 'passed' },
        { name: 'production snapshot', result: 'passed' },
        { name: 'pnpm run test', result: 'failed' },
      ],
    });
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('tests a gm smoke build and uploads the saved production snapshot', async () => {
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_smoke","buildId":"build_smoke"}' };
    const run = await publish(['blobs', '--sha', smokeTestSha, '--api', api]);
    expect(run.code).toBe(0);
    expect(run.pnpm).toContain('exec vite build --mode test --base=./');
    expect(run.pnpm.match(/run build/g)).toHaveLength(1);
    expect(checkRecords).toContainEqual(
      expect.objectContaining({
        testArtifactSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        sizes: ['390x844', '1180x820'],
        checks: expect.arrayContaining([
          { name: 'test-mode build', result: 'passed' },
          { name: 'production snapshot', result: 'passed' },
        ]),
      }),
    );
  });

  it('rejects a smoke test that changes its recorded build', async () => {
    const run = await publish(['blobs', '--sha', mutatingSmokeSha, '--api', api]);
    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain('the game checks changed the test build');
    expect(checkRecords).toContainEqual(
      expect.objectContaining({
        gitSha: mutatingSmokeSha,
        checks: expect.arrayContaining([{ name: 'test build integrity', result: 'failed' }]),
      }),
    );
  });

  it('rejects gm test when it would serve a different build', async () => {
    const run = await publish(['blobs', '--sha', wrongServeSha, '--api', api]);
    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain('gm test must use the default dist directory');
    expect(checkRecords).toContainEqual(
      expect.objectContaining({
        gitSha: wrongServeSha,
        checks: expect.arrayContaining([{ name: 'test configuration', result: 'failed' }]),
      }),
    );
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('does not publish if tests change the production build', async () => {
    const run = await publish(['blobs', '--sha', mutationSha, '--api', api]);
    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain('game checks changed the production build');
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('does not publish if checks change tracked source', async () => {
    const run = await publish(['blobs', '--sha', sourceMutationSha, '--api', api]);
    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain('game checks changed the source commit or tracked files');
    expect(checkRecords).toContainEqual(
      expect.objectContaining({
        gitSha: sourceMutationSha,
        checks: expect.arrayContaining([{ name: 'source integrity', result: 'failed' }]),
      }),
    );
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('does not publish if checks add untracked source', async () => {
    const run = await publish(['blobs', '--sha', untrackedMutationSha, '--api', api]);
    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain('game checks changed the source commit or tracked files');
    expect(checkRecords).toContainEqual(
      expect.objectContaining({
        gitSha: untrackedMutationSha,
        checks: expect.arrayContaining([{ name: 'source integrity', result: 'failed' }]),
      }),
    );
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('reports a timed out build with the configured duration instead of missing dist output', async () => {
    const run = await publish(['blobs', '--sha', slowSha, '--api', api], {
      env: { OGM_PUBLISH_BUILD_TIMEOUT_MS: '1000' },
    });

    expect(run.code).toBe(1);
    expect(run.err).toEqual(["the game's build timed out after 1 s"]);
    expect(run.err.join('\n')).not.toContain('no dist/index.html');
    expect(requests.map((r) => r.method)).toEqual(['GET']);
    expect(readdirSync(join(run.home, '.local', 'state', 'ogm', 'publish'))).toEqual([]);
    expect(git(checkout, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('refuses a nonpositive build timeout before preparing the worktree', async () => {
    const run = await publish(['blobs', '--api', api], { env: { OGM_PUBLISH_BUILD_TIMEOUT_MS: '0' } });

    expect(run.code).toBe(2);
    expect(run.err).toEqual([
      'OGM_PUBLISH_BUILD_TIMEOUT_MS must be positive. Try: set a positive millisecond value in api.env',
    ]);
    expect(run.pnpm).toBe('');
    expect(requests).toEqual([]);
  });

  // #627: the asset list is what ships, so publish refuses code that names an unlisted asset before building it.
  it('exits 1 naming an asset the code uses that assets.lock.json does not list, before building or uploading', async () => {
    const run = await publish(['blobs', '--sha', unlistedSha, '--api', api]);

    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain('t1:kenney-mini-dungeon/wall@2.0 (src/main.ts)');
    expect(run.pnpm).toBe('');
    expect(requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('refuses with exit 2 and a next step: no slug outside a game, an unknown game, no token', async () => {
    const outside = await publish(['--api', api]);
    expect(outside.code).toBe(2);
    expect(outside.err[0]).toBe('gm publish needs a game slug outside a game folder. Try: gm publish <slug>');

    const unknown = await publish(['nope', '--api', api]);
    expect(unknown.code).toBe(2);
    expect(unknown.err[0]).toContain('game "nope" is not registered');

    const noToken = await publish(['blobs', '--api', api], { home: hostHome('OGM_API_PORT=1\n') });
    expect(noToken.code).toBe(2);
    expect(noToken.err[0]).toContain('no internal token');
    expect(requests).toEqual([]);
    // OGM_ENV_DIR points at the host's env directory instead of ~/.config/ogm/env.
    const envDir = join(hostHome(), '.config', 'ogm', 'env');
    const fromEnvDir = await publish(['nope', '--api', api], {
      home: hostHome('OGM_API_PORT=1\n'),
      env: { OGM_ENV_DIR: envDir },
    });
    expect(fromEnvDir.err[0]).toContain('game "nope" is not registered');
  });
});

it('confirms a newly landed build after the upload times out', async () => {
  const originalFetch = globalThis.fetch;
  let factsReads = 0;
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/publish-checks')) return originalFetch(input, init);
    if (init?.method === 'POST' && String(input).endsWith('/builds'))
      throw new DOMException('timed out', 'TimeoutError');
    factsReads += 1;
    if (factsReads === 2) return new Response('', { status: 404 });
    if (factsReads === 3) return new Response(JSON.stringify({ state: 'filed', buildId: null }), { status: 200 });
    if (factsReads === 4)
      return new Response(JSON.stringify({ state: 'done', buildId: 'build_landed' }), {
        status: 200,
      });
    return originalFetch(input, init);
  });
  try {
    const run = await publish(['blobs', '--api', api]);
    expect(run.code).toBe(0);
    expect(run.out.join('\n')).toContain('build build_landed');
  } finally {
    mock.mockRestore();
  }
});
