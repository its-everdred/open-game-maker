import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

import { serve } from '@hono/node-server';
import { renderDaemonFiles } from '@ogm/game-repo-template';
import { StableIdSchema } from '@ogm/contracts';
import { schema } from '@ogm/db';
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

function beforeRun(): string {
  const [, block = ''] = renderDaemonFiles().hooks.split('before_run: |\n');
  return block.split('before_remove: |\n')[0]!.replace(/^ {2}/gmu, '');
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
  writeFileSync(join(dir, '.gitignore'), 'dist/\n.gm/\n.test-bin/\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'aiur/12');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'double jump');
  return { dir, sha: git('rev-parse', 'HEAD') };
}

async function runHook(cwd: string, api: string, extra: Record<string, string> = {}, runBefore = false) {
  const secretFile = join(mkdtempSync(join(tmpdir(), 'ogm-hook-secret-')), 'hook-secret');
  writeFileSync(secretFile, SECRET);
  const bin = join(cwd, '.test-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'codex'), '#!/usr/bin/env bash\nwhile [[ "$1" != -- ]]; do shift; done\nshift\nexec "$@"\n');
  chmodSync(join(bin, 'codex'), 0o755);
  const stager = join(bin, 'stage.mjs');
  writeFileSync(
    stager,
    'import { mkdirSync } from "node:fs"; mkdirSync(process.argv[3]+"/blob-store", { recursive: true });',
  );
  const child = spawn('bash', ['-c', `${runBefore ? `${beforeRun()}\n` : ''}${beforeRemove()}`], {
    cwd,
    env: {
      PATH: `${bin}:${HOOK_PATH}`,
      HOME: cwd,
      // The hook runs `pnpm run build`; reuse corepack's cache rather than downloading pnpm into the fake HOME.
      COREPACK_HOME: env.COREPACK_HOME ?? join(homedir(), '.cache', 'node', 'corepack'),
      AIUR_HOOK_TICKET_IDENTIFIER: TICKET,
      OGM_HOOK_SECRET_FILE: secretFile,
      OGM_INTERNAL_URL: api,
      OGM_PUBLISH_STAGER: stager,
      OGM_PUBLISH_ASSETS: cwd,
      OGM_PUBLISH_BLOBS: cwd,
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

function hookWorld() {
  const fixture = world();
  fixture.deps.sqlite.prepare('UPDATE games SET github_path = ? WHERE id = ?').run('', ids.game);
  return fixture;
}

describe('before_remove hook to a playable build', () => {
  it('does not automatically release when its job is cancelled during release preparation', async () => {
    const { deps, app } = hookWorld();
    deps.sqlite.prepare("UPDATE games SET visibility = 'listed' WHERE id = ?").run(ids.game);
    const runtime = releaseRuntimeFor(deps);
    runtime.source = new FsBaseDocSource(deps.config.gamesRoot);
    runtime.commit.execute = async (op) => {
      if (op.kind === 'release') deps.sqlite.prepare("UPDATE jobs SET state = 'cancelled' WHERE id = ?").run(ids.job);
      return { ok: true, sha: 'c'.repeat(40) };
    };
    const api = await serveApi(app);
    const { dir } = workspace();
    try {
      await runHook(dir, api.base);
      completeRun(deps);
      await publishStaged(deps, ids.job);
      expect(jobState(deps)).toBe('cancelled');
      expect(deps.db.select().from(schema.releases).all()).toEqual([]);
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('publishes a listed game after its checks and records the candidate SHA', async () => {
    const { deps, app } = hookWorld();
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
      expect(StableIdSchema.safeParse(deps.db.select().from(schema.releases).get()!.publishedBy).success).toBe(true);
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
  it('uploads the merged workspace build and keeps it private until release', async () => {
    const { deps, app } = hookWorld();
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
        expect(page.status).toBe(404);
        expect(readFileSync(join(deps.config.gamesRoot, ids.game, buildId, 'index.html'), 'utf8')).toContain(
          '<title>Fixture</title>',
        );
      } finally {
        await host.close();
      }
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never uploads a dist that is a link out of the workspace', async () => {
    const { deps, app } = hookWorld();
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

  it('builds the registered game within a shared repository', async () => {
    const { deps, app } = hookWorld();
    deps.sqlite.prepare('UPDATE games SET github_path = ? WHERE id = ?').run('games/castle-game', ids.game);
    const api = await serveApi(app);
    const { dir } = workspace();
    const game = join(dir, 'games/castle-game');
    mkdirSync(game, { recursive: true });
    for (const name of ['build.mjs', 'package.json', 'manifest.json', 'design', 'web'])
      renameSync(join(dir, name), join(game, name));
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'nested game'], { cwd: dir });
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).not.toContain('game publish context unavailable');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toMatchObject({ state: 'done' });
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not publish the root game when the registered nested game is missing', async () => {
    const { deps, app } = hookWorld();
    deps.sqlite.prepare('UPDATE games SET github_path = ? WHERE id = ?').run('games/missing', ids.game);
    const api = await serveApi(app);
    const { dir } = workspace();
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).toContain('game publish context unavailable');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not publish uncommitted source as the recorded commit', async () => {
    const { deps, app } = hookWorld();
    const api = await serveApi(app);
    const { dir, sha } = workspace();
    writeFileSync(join(dir, 'build.mjs'), COPY_WEB + '\n// uncommitted\n');
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).toContain('game source is not clean at the recorded commit');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
      const record = deps.sqlite.prepare('SELECT checks_json FROM publish_checks WHERE git_sha = ?').get(sha) as {
        checks_json: string;
      };
      expect(JSON.parse(record.checks_json)).toContainEqual({ name: 'source integrity', result: 'failed' });
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uploads nothing when the build fails, even with an earlier dist/ in the workspace', async () => {
    const { deps, app } = hookWorld();
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
    const { deps, app } = hookWorld();
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

  it.each(['gm test --serve old-dist', 'gm test --help'])('rejects invalid smoke script %s', async (script) => {
    const { deps, app } = hookWorld();
    const api = await serveApi(app);
    const { dir, sha } = workspace(COPY_WEB, script);
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).toContain('gm test must use the default dist directory');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
      const record = deps.sqlite
        .prepare('SELECT result, checks_json FROM publish_checks WHERE git_sha = ?')
        .get(sha) as { result: string; checks_json: string };
      expect(record.result).toBe('failed');
      expect(JSON.parse(record.checks_json)).toContainEqual({ name: 'test configuration', result: 'failed' });
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not upload when tests mutate the production build', async () => {
    const { deps, app } = hookWorld();
    const api = await serveApi(app);
    const { dir } = workspace(COPY_WEB, "node -e \"require('fs').writeFileSync('dist/index.html', 'changed')\"");
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).toContain('game checks failed: nothing uploaded');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not publish when tests modify tracked source', async () => {
    const { deps, app } = hookWorld();
    const api = await serveApi(app);
    const { dir } = workspace(COPY_WEB, "node -e \"require('fs').writeFileSync('manifest.json', '{}')\"");
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).toContain('game source changed during checks');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts skills installed by the preceding run hook', async () => {
    const { deps, app } = hookWorld();
    const api = await serveApi(app);
    const { dir } = workspace();
    mkdirSync(join(dir, '.gm/context'), { recursive: true });
    mkdirSync(join(dir, '.claude/skills/gm-prototype'), { recursive: true });
    writeFileSync(join(dir, '.gm/context/bundle.json'), JSON.stringify({ kind: 'feature' }));
    writeFileSync(join(dir, '.claude/skills/gm-prototype/SKILL.md'), 'fixture');
    try {
      const hook = await runHook(dir, api.base, {}, true);
      expect(hook.stderr).not.toContain('game source is not clean');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toMatchObject({ state: 'done' });
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not publish when a build adds source inside an injected skill directory', async () => {
    const { deps, app } = hookWorld();
    const api = await serveApi(app);
    const { dir } = workspace(
      "import { mkdirSync, writeFileSync } from 'node:fs';\n" +
        "mkdirSync('.claude/skills/gm-evil', { recursive: true });\n" +
        "writeFileSync('.claude/skills/gm-evil/generated.js', 'changed');\n" +
        COPY_WEB,
    );
    try {
      const hook = await runHook(dir, api.base);
      expect(hook.stderr).toContain('game source changed during checks');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toBeNull();
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not pass daemon credentials into game build and test processes', async () => {
    const { deps, app } = hookWorld();
    const api = await serveApi(app);
    const guard = `if (process.env.GITHUB_TOKEN || process.env.OGM_HOOK_SECRET_FILE) process.exit(1);\n`;
    const { dir } = workspace(
      guard + COPY_WEB,
      'node -e "if(process.env.GITHUB_TOKEN || process.env.OGM_HOOK_SECRET_FILE) process.exit(1)"',
    );
    try {
      const hook = await runHook(dir, api.base, { GITHUB_TOKEN: 'private-token' });
      expect(hook.stderr).not.toContain('game checks failed');
      completeRun(deps);
      expect(await publishStaged(deps, ids.job)).toMatchObject({ state: 'done' });
    } finally {
      await api.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves out a manifest that links outside the workspace, so the build fails instead of leaking the file', async () => {
    const { deps, app } = hookWorld();
    const api = await serveApi(app);
    const { dir } = workspace();
    rmSync(join(dir, 'manifest.json'));
    execFileSync('ln', ['-s', join(builtFiles(), 'manifest.json'), join(dir, 'manifest.json')]);
    execFileSync('git', ['add', 'manifest.json'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'linked manifest'], {
      cwd: dir,
    });
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
    const { deps, app } = hookWorld();
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
