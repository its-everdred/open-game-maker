import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

import { serve } from '@hono/node-server';
import { schema } from '@ogm/db';
import { renderDaemonFiles } from '@ogm/game-repo-template';
import { describe, expect, it } from 'vitest';

import { publishStaged } from '../../src/builds/publish.js';
import { createApp } from '../../src/app/app.js';
import { buildRoutes } from '../../src/builds/routes.js';
import { managedTicketAccess } from '../../src/internal/bundle.js';
import { builtFiles, completeRun, gamesHost, ids, jobState, REPO, SECRET, TICKET, world } from './fixtures.js';

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
function workspace(build = COPY_WEB) {
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
    JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'node build.mjs' } }),
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
  it('authorizes the upload with its real ticket grant and removes it afterwards', async () => {
    const { deps } = world();
    const home = mkdtempSync(join(tmpdir(), 'ogm-grant-home-'));
    const daemonDir = join(home, '.config/ogm/daemons/castle-game');
    mkdirSync(daemonDir, { recursive: true });
    const secretFile = join(daemonDir, 'hook-secret');
    writeFileSync(secretFile, SECRET);
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'castle-game',
        repo: REPO,
        checkoutPath: '/fixture',
        unit: 'fixture',
        envFile: '/fixture',
        port: 4101,
        status: 'running',
        createdAt: '2026-11-01T00:00:00Z',
      })
      .run();
    const access = managedTicketAccess(home);
    let captured: [string, string, string, string] | undefined;
    const app = createApp(deps);
    app.route(
      '/internal',
      buildRoutes({
        daemonForSecret: async (secret) => (secret === SECRET ? REPO : null),
        gameForSecret: async () => ({ repo: REPO, slug: 'castle-game' }),
        ticketAccess: async (token, hash, repo, ticket, requestDeps) => {
          captured = [token, hash, repo, ticket];
          return access(token, hash, repo, ticket, requestDeps);
        },
      }),
    );
    const api = await serveApi(app);
    const { dir } = workspace();
    try {
      const hook = await runHook(dir, api.base, { OGM_HOOK_SECRET_FILE: secretFile });
      expect(hook.stderr).toContain('build upload: HTTP 202');
      expect(captured).toBeDefined();
      expect(await access(...captured!, deps)).toBeNull();
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
