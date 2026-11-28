import { execFileSync, spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Liquid } from 'liquidjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { renderDaemonFiles, renderRepoTemplate } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SECRET = 'hook-secret-for-tests';
// Hook tests launch real Git and Node processes; the default five seconds can expire under host contention.
vi.setConfig({ testTimeout: 30_000 });
// aiur daemons run hooks with plain git; drop an agent workspace's git guard from PATH.
const HOOK_PATH = (process.env.PATH ?? '')
  .split(':')
  .filter((dir) => !dir.includes('/.aiur-runtime/'))
  .join(':');

describe('renderDaemonFiles', () => {
  it('renders the fixture hooks with no host path or secret', () => {
    const { hooks } = renderDaemonFiles();
    expect(hooks).toBe(fixture('hooks.expected'));
    expect(hooks).not.toMatch(/\/(home|Users|root|tmp)\//);
    expect(hooks).not.toMatch(/(aiur_|ghp_|github_pat_|sk-)[A-Za-z0-9]/);
    expect(Object.keys(parse(hooks))).toEqual(['after_create', 'before_run', 'before_remove']);
  });

  it('renders a game daemon’s sparse checkout and game-scope prompt', () => {
    const { hooks, prompt } = renderDaemonFiles({ gameSlug: 'castle-run' });
    const script = parse(hooks).after_create as string;

    expect(script).toContain('git clone --sparse --filter=blob:none "$THIS_REPOSITORY_URL" .');
    expect(script).toContain('git sparse-checkout set games/castle-run packages');
    expect(script).toContain('git checkout -b "${AIUR_TICKET_BRANCH:-aiur/${ticket}}" "origin/$THIS_BASE_BRANCH"');
    expect(prompt).toContain('Write only inside `games/castle-run/`');
    expect(prompt).toContain('open a separate');
    for (const text of [hooks, prompt]) expect(text).not.toContain('%%');
  });

  it('renders the whole-repo hook and prompt when the daemon has no game slug', () => {
    const { hooks, prompt } = renderDaemonFiles();
    const script = parse(hooks).after_create as string;

    expect(script).toContain('git clone "$THIS_REPOSITORY_URL" .');
    expect(script).not.toContain('sparse-checkout');
    expect(prompt).not.toContain('## Game scope');
    for (const text of [hooks, prompt]) expect(text).not.toContain('%%');
  });

  it('renders the prompt through Liquid with a sample issue', async () => {
    const engine = new Liquid();
    const issue = {
      identifier: '12',
      title: 'Add a double jump',
      state: 'agent:todo',
      labels: 'agent:todo, complexity:2',
      url: 'https://github.com/everdred-games/gm-g_01J/issues/12',
      description: 'Load skills: gm-core\n\nThe hero jumps twice.',
    };
    const rendered = await engine.parseAndRender(renderDaemonFiles().prompt, { issue, attempt: null });
    expect(rendered).toBe(fixture('prompt.expected.md'));
    expect(rendered).not.toContain('Continuation context');
    // The pre-PR look gate: a failing or broker-errored look answer must stop the worker before it opens the PR.
    expect(rendered).toContain('run `gm look check --changed`; it must pass');
    // Evidence the PR links must outlive the worker's workspace (Open-Games #214 linked a deleted assets-local sheet).
    expect(rendered).toContain('under `review/12/` in the game folder');
    expect(rendered).toContain('run `gm look evidence --body <file>`');
    const retried = await engine.parseAndRender(renderDaemonFiles().prompt, { issue, attempt: 2 });
    expect(retried).toContain('Retry attempt #2.');
  });
});

// Runs the real `after_create` script the way aiur does: in an empty dir, with aiur's and the unit's env.
describe('after_create hook', () => {
  const servers: Server[] = [];
  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  function gameRepo(stalePack = false, conflicting = false): string {
    const work = mkdtempSync(join(tmpdir(), 'ogm-hook-src-'));
    for (const file of renderRepoTemplate('game-3d@1', { gameId: 'g1', owner: 'o', visibility: 'private' }, work)
      .files) {
      const path = join(work, file.path);
      mkdirSync(join(path, '..'), { recursive: true });
      if (file.mode === '120000') execFileSync('ln', ['-s', file.content, path]);
      else writeFileSync(path, file.content);
    }
    if (stalePack)
      for (const dir of ['.claude', '.codex', '.agents']) rmSync(join(work, dir), { recursive: true, force: true });
    if (!stalePack) {
      mkdirSync(join(work, '.claude/skills/gm-core'), { recursive: true });
      writeFileSync(join(work, '.claude/skills/gm-core/SKILL.md'), 'name: gm-core\n');
      writeFileSync(join(work, 'skills.lock'), JSON.stringify({ pack: '0.0.0-placeholder' }));
    }
    if (conflicting) {
      mkdirSync(join(work, '.codex/skills'), { recursive: true });
      rmSync(join(work, '.codex/skills/gm-prototype'), { force: true });
      execFileSync('ln', ['-s', '../../attacker', join(work, '.codex/skills/gm-prototype')]);
    }
    const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    return work;
  }

  async function runHook(env: Record<string, string>, stalePack = false, conflicting = false) {
    const dir = mkdtempSync(join(tmpdir(), 'ogm-hook-ws-'));
    const secretFile = join(mkdtempSync(join(tmpdir(), 'ogm-hook-secret-')), 'hook-secret');
    writeFileSync(secretFile, SECRET);
    const hooks = parse(renderDaemonFiles().hooks) as { after_create: string; before_run: string };
    const script = `${hooks.after_create}\n${hooks.before_run}`;
    const child = spawn('bash', ['-c', script], {
      cwd: dir,
      env: {
        PATH: HOOK_PATH,
        HOME: dir,
        THIS_REPOSITORY_URL: gameRepo(stalePack, conflicting),
        THIS_BASE_BRANCH: 'main',
        AIUR_HOOK_TICKET_IDENTIFIER: '12',
        OGM_HOOK_SECRET_FILE: secretFile,
        ...env,
      },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
    return { dir, secretFile, result: { status, stderr } };
  }

  async function api(handler: Parameters<typeof createServer>[1]): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  // Match the existing hook harness: fixture repositories use the same plain Git as the hook.
  const fixtureGit = (args: string[]) => execFileSync('git', args, { env: { ...process.env, PATH: HOOK_PATH } });

  it('starts a planner child at its committed inventory and preserves resumed work', async () => {
    const repo = gameRepo();
    fixtureGit(['-C', repo, 'checkout', '-qb', 'aiur/99']);
    mkdirSync(join(repo, 'games/castle-run/docs'), { recursive: true });
    writeFileSync(join(repo, 'games/castle-run/docs/decisions.json'), '[]\n');
    execFileSync('git', ['-C', repo, 'add', 'games/castle-run/docs/decisions.json']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'planner']);
    const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    fixtureGit(['-C', repo, 'checkout', '-q', 'main']);
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            kind: 'scope',
            skillPackVersion: '0.0.0-placeholder',
            plannerBase: { branch: 'aiur/99', sha },
          }),
        );
      } else if (req.url === '/internal/jobs/by-ticket/12/planner-answers') {
        res.end(JSON.stringify({ answers: [{ question: 'Door?', answer: 'Wood' }] }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    const { dir, secretFile, result } = await runHook({ THIS_REPOSITORY_URL: repo, OGM_INTERNAL_URL: base });
    expect(result.status, result.stderr).toBe(0);
    expect(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(sha);
    expect(readFileSync(join(dir, 'games/castle-run/docs/decisions.json'), 'utf8')).toBe('[]\n');
    expect(readFileSync(join(dir, '.gm/context/planner-base.applied'), 'utf8').trim()).toBe(sha);
    writeFileSync(join(dir, 'games/castle-run/child.txt'), 'work');
    execFileSync('git', ['-C', dir, 'add', 'games/castle-run/child.txt']);
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'child']);
    const childSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const victim = join(mkdtempSync(join(tmpdir(), 'ogm-hook-victim-')), 'answers.json');
    writeFileSync(victim, 'keep');
    rmSync(join(dir, '.gm/context/planner-answers.json'));
    execFileSync('ln', ['-s', victim, join(dir, '.gm/context/planner-answers.json')]);
    const resumed = spawn('bash', ['-c', parse(renderDaemonFiles().hooks).before_run as string], {
      cwd: dir,
      env: {
        PATH: HOOK_PATH,
        HOME: dir,
        THIS_BASE_BRANCH: 'main',
        AIUR_HOOK_TICKET_IDENTIFIER: '12',
        OGM_INTERNAL_URL: base,
        OGM_HOOK_SECRET_FILE: secretFile,
      },
    });
    const status = await new Promise<number | null>((resolve) => resumed.on('close', resolve));
    expect(status).toBe(0);
    expect(readFileSync(victim, 'utf8')).toBe('keep');
    expect(JSON.parse(readFileSync(join(dir, '.gm/context/planner-answers.json'), 'utf8'))).toMatchObject({
      answers: [{ answer: 'Wood' }],
    });
    expect(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(childSha);
  });

  it('applies a recovered planner base before a warm workspace starts', async () => {
    const repo = gameRepo();
    fixtureGit(['-C', repo, 'checkout', '-qb', 'aiur/99']);
    mkdirSync(join(repo, 'games/castle-run/docs'), { recursive: true });
    writeFileSync(join(repo, 'games/castle-run/docs/decisions.json'), '[]\n');
    execFileSync('git', ['-C', repo, 'add', 'games/castle-run/docs/decisions.json']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'planner']);
    const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    fixtureGit(['-C', repo, 'checkout', '-q', 'main']);
    const { dir, secretFile, result } = await runHook({ THIS_REPOSITORY_URL: repo, OGM_INTERNAL_URL: '' });
    expect(result.status, result.stderr).toBe(0);
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle') {
        res.end(JSON.stringify({ kind: 'scope', plannerBase: { branch: 'aiur/99', sha } }));
      } else if (req.url === '/internal/jobs/by-ticket/12/planner-answers') {
        res.end(JSON.stringify({ answers: [] }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    const child = spawn('bash', ['-c', parse(renderDaemonFiles().hooks).before_run as string], {
      cwd: dir,
      env: {
        PATH: HOOK_PATH,
        HOME: dir,
        THIS_BASE_BRANCH: 'main',
        AIUR_HOOK_TICKET_IDENTIFIER: '12',
        OGM_INTERNAL_URL: base,
        OGM_HOOK_SECRET_FILE: secretFile,
      },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(status, stderr).toBe(0);
    expect(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(sha);
  });

  it('does not mark a missing planner ref as applied', async () => {
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: '' });
    expect(result.status, result.stderr).toBe(0);
    writeFileSync(
      join(dir, '.gm/context/bundle.json'),
      JSON.stringify({
        kind: 'scope',
        plannerBase: { branch: 'aiur/missing', sha: 'a'.repeat(40) },
      }),
    );
    expect(() =>
      execFileSync('bash', ['-c', parse(renderDaemonFiles().hooks).before_run as string], {
        cwd: dir,
        env: { PATH: HOOK_PATH, HOME: dir, THIS_BASE_BRANCH: 'main', AIUR_HOOK_TICKET_IDENTIFIER: '12' },
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(existsSync(join(dir, '.gm/context/planner-base.applied'))).toBe(false);
  }, 30000);

  it('rejects a symlinked context before touching its destination', async () => {
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: '' });
    expect(result.status, result.stderr).toBe(0);
    const outside = mkdtempSync(join(tmpdir(), 'ogm-hook-other-'));
    writeFileSync(join(outside, 'planner-answers.json'), 'keep');
    rmSync(join(dir, '.gm/context'), { recursive: true, force: true });
    execFileSync('ln', ['-s', outside, join(dir, '.gm/context')]);
    expect(() =>
      execFileSync('bash', ['-c', parse(renderDaemonFiles().hooks).before_run as string], {
        cwd: dir,
        env: { PATH: HOOK_PATH, HOME: dir, THIS_BASE_BRANCH: 'main', AIUR_HOOK_TICKET_IDENTIFIER: '12' },
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(readFileSync(join(outside, 'planner-answers.json'), 'utf8')).toBe('keep');
  }, 30000);

  it('keeps the clone and marks the bundle missing when the API is down', async () => {
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: 'http://127.0.0.1:9' });
    expect(result.status).not.toBe(0);
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('aiur/12');
    expect(readFileSync(join(dir, '.gm/context/bundle.missing'), 'utf8')).toBe('bundle unavailable\n');
    expect(existsSync(join(dir, '.gm/context/bundle.json'))).toBe(false);
  });

  it('recovers a protected bundle with the new workspace grant before work', async () => {
    const seen: { token?: string; workspace?: string }[] = [];
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle') {
        const token = req.headers['x-ogm-preview-token'];
        const workspace = req.headers['x-ogm-workspace'];
        seen.push({
          token: typeof token === 'string' ? token : undefined,
          workspace: typeof workspace === 'string' ? workspace : undefined,
        });
        if (!token || !workspace) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.end(JSON.stringify({ kind: 'scope', skillPackVersion: '0.0.0-placeholder' }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: base });
    expect(result.status, result.stderr).toBe(0);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.token).toBeUndefined();
    expect(seen[1]?.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(seen[1]?.workspace).toBe(createHash('sha256').update(dir).digest('hex'));
    expect(existsSync(join(dir, '.gm/context/bundle.json'))).toBe(true);
  }, 60000);

  it('refuses a missing planner bundle while allowing unrelated tickets without one', async () => {
    let plannerChild = true;
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/planner-guard') res.end(JSON.stringify({ plannerChild }));
      else {
        res.statusCode = 404;
        res.end();
      }
    });
    const child = await runHook({ OGM_INTERNAL_URL: base });
    expect(child.result.status).not.toBe(0);
    expect(child.result.stderr).toContain('planner bundle unavailable');
    plannerChild = false;
    const unrelated = await runHook({ OGM_INTERNAL_URL: base });
    expect(unrelated.result.status, unrelated.result.stderr).toBe(0);
  }, 30000);

  it('provisions a scoped credential without an API URL', async () => {
    const { dir, secretFile, result } = await runHook({ OGM_INTERNAL_URL: '' });
    expect(result.status).toBe(0);
    const preview = JSON.parse(readFileSync(join(dir, '.gm/context/preview.json'), 'utf8')) as { token: string };
    expect(preview.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(preview).not.toHaveProperty('url');
    const claims = JSON.parse(Buffer.from(preview.token.split('.')[0]!, 'base64url').toString('utf8')) as {
      ticket: string;
      grant: string;
    };
    const workspaceHash = createHash('sha256').update(dir).digest('hex');
    expect(JSON.parse(readFileSync(join(secretFile, '..', 'preview-grants', `${workspaceHash}.json`), 'utf8'))).toEqual(
      claims,
    );
    execFileSync('bash', ['-c', parse(renderDaemonFiles().hooks).before_remove as string], {
      cwd: dir,
      env: { PATH: HOOK_PATH, HOME: dir, OGM_HOOK_SECRET_FILE: secretFile },
    });
    expect(existsSync(join(secretFile, '..', 'preview-grants', `${workspaceHash}.json`))).toBe(false);
  });

  it('downloads the current creator design for the worker as context', async () => {
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle') {
        res.end(
          JSON.stringify({ v: 1, skillPackVersion: '0.0.0-placeholder', skillPackUrl: 'http://127.0.0.1:9/x.tgz' }),
        );
      } else if (req.url === '/internal/jobs/by-ticket/12/design') {
        res.end(
          JSON.stringify({
            rev: 2,
            buildId: null,
            doc: { schemaVersion: 1, globals: { scenery: 'forest' }, entities: {} },
          }),
        );
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: base });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, '.gm/context/design.json'), 'utf8')).doc.globals.scenery).toBe('forest');
    expect(readFileSync(join(dir, '.gm/context/ticket'), 'utf8')).toBe('12\n');
    const preview = JSON.parse(readFileSync(join(dir, '.gm/context/preview.json'), 'utf8')) as {
      token: string;
    };
    expect(preview.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [payload, signature] = preview.token.split('.');
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')).ticket).toBe('12');
    expect(signature).toBe(createHmac('sha256', SECRET).update(`preview:${payload}`).digest('base64url'));
    expect(readFileSync(join(dir, '.gm/context/preview.json'), 'utf8')).not.toContain(SECRET);
  });

  it('marks malformed design responses unavailable instead of trusting them', async () => {
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle') {
        res.end(
          JSON.stringify({ v: 1, skillPackVersion: '0.0.0-placeholder', skillPackUrl: 'http://127.0.0.1:9/x.tgz' }),
        );
      } else {
        res.end('not a design');
      }
    });
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: base });
    expect(result.status).toBe(0);
    expect(existsSync(join(dir, '.gm/context/design.json'))).toBe(false);
    expect(readFileSync(join(dir, '.gm/context/design.missing'), 'utf8')).toBe('design snapshot unavailable\n');
  });

  it('writes the bundle and refreshes the gm-* skills when the pack version differs', async () => {
    const pack = mkdtempSync(join(tmpdir(), 'ogm-hook-pack-'));
    mkdirSync(join(pack, 'gm-core'));
    writeFileSync(join(pack, 'gm-core/SKILL.md'), 'core 1.0.0\n');
    const tgz = execFileSync('tar', ['-czf', '-', '-C', pack, 'gm-core']);
    const seen: string[] = [];
    const base = await api((req, res) => {
      seen.push(`${req.url} ${req.headers.authorization}`);
      if (req.url === '/internal/jobs/by-ticket/12/bundle') {
        res.end(JSON.stringify({ v: 1, skillPackVersion: '1.0.0', skillPackUrl: `${base}/internal/skills/1.0.0.tgz` }));
      } else if (req.url === '/internal/skills/1.0.0.tgz') {
        res.end(tgz);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const { dir, result } = await runHook({ OGM_INTERNAL_URL: base, AIUR_TICKET_BRANCH: 'aiur/12-double-jump' });
    expect(result.stderr).not.toMatch(/curl|tar|error/i);
    expect(result.status).toBe(0);
    expect(seen).toEqual([
      `/internal/jobs/by-ticket/12/bundle Bearer ${SECRET}`,
      `/internal/jobs/by-ticket/12/design Bearer ${SECRET}`,
      `/internal/skills/1.0.0.tgz Bearer ${SECRET}`,
    ]);
    expect(JSON.parse(readFileSync(join(dir, '.gm/context/bundle.json'), 'utf8')).skillPackVersion).toBe('1.0.0');
    expect(readFileSync(join(dir, '.claude/skills/gm-core/SKILL.md'), 'utf8')).toBe('core 1.0.0\n');
    expect(readFileSync(join(dir, '.codex/skills/gm-core/SKILL.md'), 'utf8')).toBe('core 1.0.0\n');
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim()).toBe(
      'aiur/12-double-jump',
    );
    expect(execFileSync('git', ['status', '--short', '--', '.gm'], { cwd: dir, encoding: 'utf8' })).toBe('');
  });

  it('refreshes a same-version feature pack missing gm-prototype', async () => {
    const pack = mkdtempSync(join(tmpdir(), 'ogm-hook-prototype-'));
    mkdirSync(join(pack, 'gm-prototype'));
    writeFileSync(join(pack, 'gm-prototype/SKILL.md'), 'prototype\n');
    const tgz = execFileSync('tar', ['-czf', '-', '-C', pack, 'gm-prototype']);
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle')
        res.end(
          JSON.stringify({ v: 1, kind: 'feature', skillPackVersion: '0.0.0', skillPackUrl: `${base}/skills.tgz` }),
        );
      else if (req.url === '/internal/skills/0.0.0.tgz') res.end(tgz);
      else {
        res.statusCode = 404;
        res.end();
      }
    });
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: base }, true);
    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, '.claude/skills/gm-prototype/SKILL.md'), 'utf8')).toBe('prototype\n');
    expect(readFileSync(join(dir, '.codex/skills/gm-prototype/SKILL.md'), 'utf8')).toBe('prototype\n');
    expect(readFileSync(join(dir, '.agents/skills/gm-prototype/SKILL.md'), 'utf8')).toBe('prototype\n');
    expect(readFileSync(join(dir, '.gm/context/design.missing'), 'utf8')).toBe('design snapshot unavailable\n');
  });

  it('refreshes a same-version New Game planner pack before running the worker', async () => {
    const pack = mkdtempSync(join(tmpdir(), 'ogm-hook-planner-'));
    mkdirSync(join(pack, 'gm-new-game-plan/scripts'), { recursive: true });
    writeFileSync(join(pack, 'gm-new-game-plan/SKILL.md'), 'planner\n');
    for (const script of ['context', 'relay', 'child'])
      writeFileSync(join(pack, `gm-new-game-plan/scripts/${script}.mjs`), `${script}\n`);
    const tgz = execFileSync('tar', ['-czf', '-', '-C', pack, 'gm-new-game-plan']);
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle')
        res.end(
          JSON.stringify({ v: 1, kind: 'new_game', skillPackVersion: '0.0.0', skillPackUrl: `${base}/skills.tgz` }),
        );
      else if (req.url === '/internal/skills/0.0.0.tgz') res.end(tgz);
      else {
        res.statusCode = 404;
        res.end();
      }
    });
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: base }, true);
    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, '.claude/skills/gm-new-game-plan/scripts/context.mjs'), 'utf8')).toBe('context\n');
    expect(readFileSync(join(dir, '.agents/skills/gm-new-game-plan/SKILL.md'), 'utf8')).toBe('planner\n');
  });

  it('retries a missing feature skill in the retained workspace', async () => {
    const pack = mkdtempSync(join(tmpdir(), 'ogm-hook-retry-'));
    mkdirSync(join(pack, 'gm-prototype'));
    writeFileSync(join(pack, 'gm-prototype/SKILL.md'), 'prototype\n');
    const tgz = execFileSync('tar', ['-czf', '-', '-C', pack, 'gm-prototype']);
    let ready = false;
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle')
        res.end(
          JSON.stringify({ v: 1, kind: 'feature', skillPackVersion: '0.0.0', skillPackUrl: `${base}/missing.tgz` }),
        );
      else if (req.url === '/internal/skills/0.0.0.tgz' && ready) res.end(tgz);
      else if (req.url === '/internal/jobs/by-ticket/12/design')
        res.end(JSON.stringify({ rev: 0, buildId: null, doc: { schemaVersion: 1, globals: {}, entities: {} } }));
      else {
        res.statusCode = 404;
        res.end();
      }
    });
    const { dir, secretFile, result } = await runHook({ OGM_INTERNAL_URL: base }, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('required gm-prototype skill is unavailable');
    const hook = (parse(renderDaemonFiles().hooks) as { before_run: string }).before_run;
    mkdirSync(join(dir, '.claude/skills/gm-prototype'), { recursive: true });
    writeFileSync(join(dir, '.claude/skills/gm-prototype/SKILL.md'), 'rogue\n');
    const runAgain = () =>
      spawn('bash', ['-c', hook], {
        cwd: dir,
        env: {
          PATH: HOOK_PATH,
          OGM_INTERNAL_URL: base,
          OGM_HOOK_SECRET_FILE: secretFile,
          AIUR_HOOK_TICKET_IDENTIFIER: '12',
        },
      });
    let child = runAgain();
    expect(await new Promise<number | null>((resolve) => child.on('close', resolve))).not.toBe(0);
    expect(existsSync(join(dir, '.gm/context/bundle.missing'))).toBe(true);
    ready = true;
    child = runAgain();
    expect(await new Promise<number | null>((resolve) => child.on('close', resolve))).toBe(0);
    expect(readFileSync(join(dir, '.agents/skills/gm-prototype/SKILL.md'), 'utf8')).toBe('prototype\n');
  });

  it('refuses conflicting skill discovery links in a game repository', async () => {
    const pack = mkdtempSync(join(tmpdir(), 'ogm-hook-conflict-'));
    mkdirSync(join(pack, 'gm-prototype'));
    writeFileSync(join(pack, 'gm-prototype/SKILL.md'), 'prototype\n');
    const tgz = execFileSync('tar', ['-czf', '-', '-C', pack, 'gm-prototype']);
    const base = await api((req, res) => {
      if (req.url === '/internal/jobs/by-ticket/12/bundle')
        res.end(
          JSON.stringify({ v: 1, kind: 'feature', skillPackVersion: '0.0.0', skillPackUrl: `${base}/skills.tgz` }),
        );
      else if (req.url === '/internal/skills/0.0.0.tgz') res.end(tgz);
      else {
        res.statusCode = 404;
        res.end();
      }
    });
    const { result } = await runHook({ OGM_INTERNAL_URL: base }, false, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unsafe skill discovery link');
  });

  it('retries an unavailable bundle before starting the retained workspace', async () => {
    const pack = mkdtempSync(join(tmpdir(), 'ogm-hook-bundle-retry-'));
    mkdirSync(join(pack, 'gm-prototype'));
    writeFileSync(join(pack, 'gm-prototype/SKILL.md'), 'prototype\n');
    const tgz = execFileSync('tar', ['-czf', '-', '-C', pack, 'gm-prototype']);
    let ready = false;
    const blob = 'a_00000000-0000-4000-8000-000000000001';
    const base = await api((req, res) => {
      if (ready && req.url === '/internal/jobs/by-ticket/12/bundle')
        res.end(
          JSON.stringify({
            v: 1,
            kind: 'feature',
            skillPackVersion: '0.0.0',
            skillPackUrl: `${base}/skills.tgz`,
            attachments: [{ blob, path: `.gm/inbox/attachments/${blob}-notes.md` }],
          }),
        );
      else if (ready && req.url === '/internal/skills/0.0.0.tgz') res.end(tgz);
      else if (ready && req.url === '/internal/jobs/by-ticket/12/design')
        res.end(JSON.stringify({ rev: 0, buildId: null, doc: { schemaVersion: 1, globals: {}, entities: {} } }));
      else if (ready && req.url === `/internal/jobs/by-ticket/12/attachments/${blob}`) res.end('creator input');
      else {
        res.statusCode = 503;
        res.end();
      }
    });
    const { dir, secretFile } = await runHook({ OGM_INTERNAL_URL: base }, true);
    expect(existsSync(join(dir, '.gm/context/bundle.json'))).toBe(false);
    const victim = join(mkdtempSync(join(tmpdir(), 'ogm-hook-recovery-victim-')), 'victim');
    writeFileSync(victim, 'unchanged');
    execFileSync('ln', ['-s', victim, join(dir, '.gm/context/attachments.retry')]);
    mkdirSync(join(dir, '.gm/inbox/attachments'), { recursive: true });
    execFileSync('ln', ['-s', victim, join(dir, `.gm/inbox/attachments/${blob}-notes.md`)]);
    ready = true;
    const hook = (parse(renderDaemonFiles().hooks) as { before_run: string }).before_run;
    const child = spawn('bash', ['-c', hook], {
      cwd: dir,
      env: {
        PATH: HOOK_PATH,
        OGM_INTERNAL_URL: base,
        OGM_HOOK_SECRET_FILE: secretFile,
        AIUR_HOOK_TICKET_IDENTIFIER: '12',
      },
    });
    expect(await new Promise<number | null>((resolve) => child.on('close', resolve))).toBe(0);
    expect(readFileSync(join(dir, '.agents/skills/gm-prototype/SKILL.md'), 'utf8')).toBe('prototype\n');
    expect(readFileSync(join(dir, `.gm/inbox/attachments/${blob}-notes.md`), 'utf8')).toBe('creator input');
    expect(readFileSync(victim, 'utf8')).toBe('unchanged');
    expect(existsSync(join(dir, '.gm/context/design.json'))).toBe(true);
  });

  // Acceptance (#222): the creator's files are in the workspace before the worker starts, and a bundle entry that
  // names a path outside the inbox is never fetched or written.
  it('downloads the attachments the bundle lists into .gm/inbox/attachments', async () => {
    const md = 'a_00000000-0000-4000-8000-000000000001';
    const image = 'a_00000000-0000-4000-8000-000000000002';
    const hostile = 'a_00000000-0000-4000-8000-000000000003';
    const seen: string[] = [];
    const base = await api((req, res) => {
      seen.push(`${req.url} ${req.headers.authorization}`);
      if (req.url === '/internal/jobs/by-ticket/12/bundle') {
        res.end(
          JSON.stringify({
            v: 1,
            skillPackVersion: '0.0.0-placeholder',
            skillPackUrl: 'http://127.0.0.1:9/x.tgz',
            attachments: [
              { kind: 'text', blob: md, path: `.gm/inbox/attachments/${md}-notes.md` },
              { kind: 'image', blob: image, path: `.gm/inbox/attachments/${image}-castle.webp` },
              { kind: 'text', blob: hostile, path: 'AGENTS.md' },
            ],
          }),
        );
      } else if (req.url === `/internal/jobs/by-ticket/12/attachments/${md}`) {
        res.end('# Castle\n');
      } else if (req.url === `/internal/jobs/by-ticket/12/attachments/${image}`) {
        res.end(Buffer.from([0x52, 0x49, 0x46, 0x46]));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const { dir, result } = await runHook({ OGM_INTERNAL_URL: base });
    expect(result.stderr).not.toMatch(/SyntaxError|node:|attachments/);
    expect(result.status).toBe(0);
    expect(seen).toEqual([
      `/internal/jobs/by-ticket/12/bundle Bearer ${SECRET}`,
      `/internal/jobs/by-ticket/12/design Bearer ${SECRET}`,
      `/internal/jobs/by-ticket/12/attachments/${md} Bearer ${SECRET}`,
      `/internal/jobs/by-ticket/12/attachments/${image} Bearer ${SECRET}`,
    ]);
    expect(readFileSync(join(dir, `.gm/inbox/attachments/${md}-notes.md`), 'utf8')).toBe('# Castle\n');
    expect(readFileSync(join(dir, `.gm/inbox/attachments/${image}-castle.webp`))).toEqual(
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
    );
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).not.toContain('Castle');
    expect(execFileSync('git', ['status', '--short'], { cwd: dir, encoding: 'utf8' })).toBe('');
  });

  it('leaves the shipped skills alone when the pack version matches', async () => {
    const seen: string[] = [];
    const base = await api((req, res) => {
      seen.push(req.url ?? '');
      if (req.url !== '/internal/jobs/by-ticket/12/bundle') {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.end(
        JSON.stringify({ v: 1, skillPackVersion: '0.0.0-placeholder', skillPackUrl: 'http://127.0.0.1:9/x.tgz' }),
      );
    });
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: base });
    expect(result.status).toBe(0);
    expect(seen).toEqual(['/internal/jobs/by-ticket/12/bundle', '/internal/jobs/by-ticket/12/design']);
    expect(readFileSync(join(dir, '.gm/context/design.missing'), 'utf8')).toBe('design snapshot unavailable\n');
    expect(readFileSync(join(dir, '.claude/skills/gm-core/SKILL.md'), 'utf8')).toContain('name: gm-core');
  });
});
