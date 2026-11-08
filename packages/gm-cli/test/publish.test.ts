import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

const TOKEN = 'internal-token-for-publish-tests';

type Logged = { method: string; url: string; token: string; sha: string; body: Buffer };

let server: Server;
let api: string;
let requests: Logged[] = [];
let uploadAnswer: { status: number; body: string } = { status: 201, body: '' };
let root: string;
let origin: string;
let checkout: string;
let bin: string;
let staleSha: string;
let remoteSha: string;
let brokenSha: string;

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
      'printf "%s\\n" "$*" > "$BUILD_ARGS_LOG"',
      'printf "token=%s mode=%s assets=%s\\n" "${OGM_INTERNAL_TOKEN:-}" "$NODE_ENV" "${OGM_ASSETS_ROOT:-}" > "$BUILD_ENV_LOG"',
      'mkdir -p dist/design dist/assets',
      `printf '<!doctype html><script type="module" src="./assets/main.js"></script><!-- ${marker} -->\\n' > dist/index.html`,
      'printf "console.log(1)\\n" > dist/assets/main.js',
      `printf '{"id":"blobs","sdk":"1.0.0"}\\n' > dist/manifest.json`,
      `printf '{"schemaVersion":1,"globals":{},"entities":{}}\\n' > dist/design/design.json`,
      `printf '{"version":1,"packs":[]}\\n' > dist/credits.json`,
      '',
    ].join('\n'),
  );
  writeFileSync(join(game, 'package.json'), '{"name":"blobs","private":true,"scripts":{"build":"sh build.sh"}}\n');
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
  git(origin, 'add', '-A');
  git(origin, 'commit', '-qm', 'old');
  staleSha = git(origin, 'rev-parse', 'HEAD');
  checkout = join(root, 'checkout');
  execFileSync('git', ['clone', '-q', origin, checkout]);
  writeGame(origin, 'new');
  git(origin, 'commit', '-qam', 'new');
  remoteSha = git(origin, 'rev-parse', 'HEAD');
  // A commit only origin has, on a side branch, whose build fails.
  git(origin, 'switch', '-qc', 'broken');
  writeFileSync(join(origin, 'games', 'blobs', 'build.sh'), 'echo "vite: cannot resolve ./src/main.ts" >&2\nexit 3\n');
  git(origin, 'commit', '-qam', 'broken');
  brokenSha = git(origin, 'rev-parse', 'HEAD');
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
      '[[ ${1:-} == run ]] && shift',
      '[[ ${1:-} == build ]] && shift',
      '[[ ${1:-} == -- ]] && shift',
      'exec sh -c "$(node -p \'require("./package.json").scripts.build\') $*"',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'pnpm'), 0o755);

  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
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
      if (request.method === 'POST' && request.url === '/internal/operator/games/blobs/builds') {
        return json(uploadAnswer.status, uploadAnswer.body);
      }
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
  apiEnv = `OGM_INTERNAL_TOKEN=${TOKEN}\nOGM_API_PORT=1\nOGM_APP_ORIGIN=https://play.example\n`,
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
    ...options.env,
  };
  requests = [];
  const result = await gm(['publish', ...argv], { home, env, ...(options.cwd ? { cwd: options.cwd } : {}) });
  const read = (name: string) => (existsSync(join(logs, name)) ? readFileSync(join(logs, name), 'utf8') : '');
  return { ...result, home, pnpm: read('pnpm'), args: read('args'), buildEnv: read('env') };
}

describe('gm publish', () => {
  it("builds the repository's remote main, not the checkout's stale origin/main, and prints the build and play link", async () => {
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_publish","buildId":"build_publish"}' };
    expect(git(checkout, 'rev-parse', 'origin/main')).toBe(staleSha);

    // The token in the environment reaches the API and never the build.
    const run = await publish(['blobs', '--api', api], { env: { OGM_INTERNAL_TOKEN: TOKEN } });

    expect(run.err).toEqual([]);
    expect(run.code).toBe(0);
    expect(run.out).toEqual([
      `building games/blobs at ${remoteSha}`,
      `published games/blobs at ${remoteSha}: build build_publish`,
      'play https://play.example/play/blobs',
    ]);
    const upload = requests.find((r) => r.method === 'POST')!;
    expect(upload).toMatchObject({ url: '/internal/operator/games/blobs/builds', token: TOKEN, sha: remoteSha });
    // The production build: relative base, published mode, the asset library, and never the operator's token.
    expect(run.pnpm).toContain('install --frozen-lockfile');
    expect(run.args.trim()).toBe('--base=./ --mode=published');
    expect(run.buildEnv.trim()).toBe(`token= mode=production assets=${join(root, 'assets-local')}`);
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

  it('defaults the slug to the game folder it runs in and builds an explicit --sha', async () => {
    uploadAnswer = { status: 201, body: '{"state":"done","jobId":"j_2","buildId":"build_2"}' };

    const run = await publish(['--sha', staleSha, '--api', api, '--json'], { cwd: join(checkout, 'games', 'blobs') });

    expect(run.code).toBe(0);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /internal/operator/games/blobs',
      'POST /internal/operator/games/blobs/builds',
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
        play: 'https://play.example/play/blobs',
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

  it('fetches a --sha only origin has, exits 1 with the build output when the build fails, and cleans up', async () => {
    const run = await publish(['blobs', '--sha', brokenSha, '--api', api]);

    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain("the game's build failed");
    expect(run.err.join('\n')).toContain('vite: cannot resolve ./src/main.ts');
    expect(requests.map((r) => r.method)).toEqual(['GET']);
    expect(readdirSync(join(run.home, '.local', 'state', 'ogm', 'publish'))).toEqual([]);
    expect(git(checkout, 'worktree', 'list').split('\n')).toHaveLength(1);
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
