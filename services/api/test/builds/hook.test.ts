import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

import { serve } from '@hono/node-server';
import { renderDaemonFiles } from '@ogm/game-repo-template';
import { describe, expect, it } from 'vitest';

import { publishStaged } from '../../src/builds/publish.js';
import { FsBaseDocSource } from '../../src/design/base-doc.js';
import { releaseRuntimeFor } from '../../src/releases/routes.js';
import { builtFiles, completeRun, gamesHost, ids, jobState, SECRET, TICKET, world } from './fixtures.js';

// aiur daemons run hooks with plain git; drop an agent workspace's git guard from PATH.
const HOOK_PATH = (env.PATH ?? '')
  .split(':')
  .filter((dir) => !dir.includes('/.aiur-runtime/'))
  .join(':');

// The `before_remove` block of the rendered hooks file, unindented.
function beforeRemove(): string {
  const [, block = ''] = renderDaemonFiles().hooks.split('before_remove: |\n');
  return block.replace(/^ {2}/gmu, '');
}

const COPY_WEB = "import { cpSync } from 'node:fs';\ncpSync('web', 'dist', { recursive: true });\n";

// A workspace as the agent leaves it: a committed game repo whose `pnpm run build` (here `node build.mjs`) writes dist/.
function workspace(build = COPY_WEB, test = "node -e \"require('fs').accessSync('dist/index.html')\"") {
  const dir = mkdtempSync(join(tmpdir(), 'ogm-hook-build-ws-'));
  const built = builtFiles();
  mkdirSync(join(dir, 'web'));
  cpSync(join(built, 'index.html'), join(dir, 'web', 'index.html'));
  cpSync(join(built, 'assets'), join(dir, 'web', 'assets'), { recursive: true });
  cpSync(join(built, 'credits.json'), join(dir, 'web', 'credits.json'));
  cpSync(join(built, 'manifest.json'), join(dir, 'manifest.json'));
  cpSync(join(built, 'design'), join(dir, 'design'), { recursive: true });
  writeFileSync(join(dir, 'build.mjs'), build);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'node build.mjs', test } }),
  );
  writeFileSync(join(dir, '.gitignore'), 'dist/\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'aiur/12');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'double jump');
  return { dir, sha: git('rev-parse', 'HEAD') };
}

async function runHook(cwd: string, api: string, extra: Record<string, string> = {}) {
  const secretFile = join(mkdtempSync(join(tmpdir(), 'ogm-hook-secret-')), 'hook-secret');
  writeFileSync(secretFile, SECRET);
  const child = spawn('bash', ['-c', beforeRemove()], {
    cwd,
    env: {
      PATH: HOOK_PATH,
      HOME: cwd,
      // The hook runs `pnpm run build`; reuse corepack's cache rather than downloading pnpm into the fake HOME.
      COREPACK_HOME: env.COREPACK_HOME ?? join(homedir(), '.cache', 'node', 'corepack'),
      AIUR_HOOK_TICKET_IDENTIFIER: TICKET,
      OGM_HOOK_SECRET_FILE: secretFile,
      OGM_INTERNAL_URL: api,
      ...extra,
    },
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
  return { status, stderr };
}

async function serveApi(app: ReturnType<typeof world>['app']) {
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('before_remove hook to a playable build', () => {
  it('publishes a listed game after its checks and records the candidate SHA', async () => {
    const { deps, app } = world();
    deps.sqlite.prepare("UPDATE games SET visibility = 'listed' WHERE id = ?").run(ids.game);
    releaseRuntimeFor(deps).source = new FsBaseDocSource(deps.config.gamesRoot);
    const api = await serveApi(app);
    const { dir, sha } = workspace();
    try {
      await runHook(dir, api.base);
      completeRun(deps);
      const outcome = await publishStaged(deps, ids.job);
      expect(outcome?.state).toBe('done');
      const game = deps.sqlite.prepare('SELECT published_release_id FROM games WHERE id = ?').get(ids.game) as {
        published_release_id: string | null;
      };
      expect(game.published_release_id).not.toBeNull();
      const record = deps.sqlite
        .prepare('SELECT git_sha, result, publish_result, build_id FROM publish_checks WHERE git_sha = ?')
        .get(sha);
      expect(record).toEqual({
        git_sha: sha,
        result: 'passed',
        publish_result: 'published',
        build_id: outcome?.state === 'done' ? outcome.buildId : '',
      });
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('uploads the merged workspace build, which the API publishes and the games host serves', async () => {
    const { deps, app } = world();
    const api = await serveApi(app);
    const { dir, sha } = workspace();
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).not.toMatch(/curl|tar|error/i);
      expect(hook.status).toBe(0);
      expect(jobState(deps)).toBe('running');

      // The feed then reports the merge; main.ts hands the job to the publisher.
      completeRun(deps);
      const outcome = await publishStaged(deps, ids.job);
      expect(outcome).toMatchObject({ state: 'done' });
      const buildId = outcome?.state === 'done' ? outcome.buildId : '';
      const row = deps.sqlite
        .prepare<[string], { git_sha: string; status: string }>('SELECT git_sha, status FROM builds WHERE id = ?')
        .get(buildId);
      expect(row).toEqual({ git_sha: sha, status: 'tested' });
      const game = deps.sqlite.prepare('SELECT visibility, published_release_id FROM games WHERE id = ?').get(ids.game);
      expect(game).toEqual({ visibility: 'private', published_release_id: null });
      const record = deps.sqlite
        .prepare('SELECT result, publish_result, build_id FROM publish_checks WHERE git_sha = ?')
        .get(sha);
      expect(record).toEqual({ result: 'passed', publish_result: 'skipped', build_id: buildId });

      const host = await gamesHost(deps.config.gamesRoot);
      try {
        const page = await fetch(`${host.base}/g/${ids.game}/${buildId}/`);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('<title>Fixture</title>');
      } finally {
        await host.close();
      }
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never uploads a dist that is a link out of the workspace', async () => {
    const { deps, app } = world();
    const api = await serveApi(app);
    const outside = builtFiles();
    const { dir } = workspace(
      `import { symlinkSync } from 'node:fs';\nsymlinkSync(${JSON.stringify(outside)}, 'dist');\n`,
    );
    try {
      expect((await runHook(dir, api.base)).status).toBe(0);
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
      expect(jobState(deps)).toBe('running');
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uploads nothing when the build fails, even with an earlier dist/ in the workspace', async () => {
    const { deps, app } = world();
    const api = await serveApi(app);
    // The build writes part of dist/ before failing; neither that nor the earlier dist/ may leave.
    const { dir } = workspace(
      "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist');\nwriteFileSync('dist/index.html', 'partial');\nprocess.exit(1);\n",
    );
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><title>Stale</title>\n');
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.status).toBe(0);
      expect(hook.stderr).toContain('build failed: nothing uploaded');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
      expect(jobState(deps)).toBe('running');
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uploads nothing when the game tests fail', async () => {
    const { deps, app } = world();
    const api = await serveApi(app);
    const { dir, sha } = workspace(COPY_WEB, 'node -e "process.exit(1)"');
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).toContain('game checks failed: nothing uploaded');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
      const record = deps.sqlite
        .prepare('SELECT result, publish_result FROM publish_checks WHERE git_sha = ?')
        .get(sha);
      expect(record).toEqual({ result: 'failed', publish_result: 'skipped' });
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves out a manifest that links outside the workspace, so the build fails instead of leaking the file', async () => {
    const { deps, app } = world();
    const api = await serveApi(app);
    const { dir } = workspace();
    rmSync(join(dir, 'manifest.json'));
    execFileSync('ln', ['-s', join(builtFiles(), 'manifest.json'), join(dir, 'manifest.json')]);
    try {
      expect((await runHook(dir, api.base)).status).toBe(0);
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toEqual({ state: 'failed', reason: 'manifest_invalid' });
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends nothing without the daemon hook secret', async () => {
    const { deps, app } = world();
    const api = await serveApi(app);
    const { dir } = workspace();
    try {
      expect((await runHook(dir, api.base, { OGM_HOOK_SECRET_FILE: join(dir, 'missing') })).status).toBe(0);
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
      expect(jobState(deps)).toBe('running');
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
