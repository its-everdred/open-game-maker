import { execFileSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Liquid } from 'liquidjs';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { renderDaemonFiles, renderRepoTemplate } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SECRET = 'hook-secret-for-tests';
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
    expect(Object.keys(parse(hooks))).toEqual(['after_create', 'before_remove']);
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

  function gameRepo(): string {
    const work = mkdtempSync(join(tmpdir(), 'ogm-hook-src-'));
    for (const file of renderRepoTemplate('game-3d@1', { gameId: 'g1', owner: 'o', visibility: 'private' }, work)
      .files) {
      const path = join(work, file.path);
      mkdirSync(join(path, '..'), { recursive: true });
      if (file.mode === '120000') execFileSync('ln', ['-s', file.content, path]);
      else writeFileSync(path, file.content);
    }
    const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    return work;
  }

  async function runHook(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'ogm-hook-ws-'));
    const secretFile = join(mkdtempSync(join(tmpdir(), 'ogm-hook-secret-')), 'hook-secret');
    writeFileSync(secretFile, SECRET);
    const script = parse(renderDaemonFiles().hooks).after_create as string;
    const child = spawn('bash', ['-c', script], {
      cwd: dir,
      env: {
        PATH: HOOK_PATH,
        HOME: dir,
        THIS_REPOSITORY_URL: gameRepo(),
        THIS_BASE_BRANCH: 'main',
        AIUR_HOOK_TICKET_IDENTIFIER: '12',
        OGM_HOOK_SECRET_FILE: secretFile,
        ...env,
      },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
    return { dir, result: { status, stderr } };
  }

  async function api(handler: Parameters<typeof createServer>[1]): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('keeps the clone and marks the bundle missing when the API is down', async () => {
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: 'http://127.0.0.1:9' });
    expect(result.status).toBe(0);
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('aiur/12');
    expect(readFileSync(join(dir, '.gm/context/bundle.missing'), 'utf8')).toBe('bundle unavailable\n');
    expect(existsSync(join(dir, '.gm/context/bundle.json'))).toBe(false);
  });

  it('provisions a scoped credential without an API URL', async () => {
    const { dir, result } = await runHook({ OGM_INTERNAL_URL: '' });
    expect(result.status).toBe(0);
    const preview = JSON.parse(readFileSync(join(dir, '.gm/context/preview.json'), 'utf8')) as { token: string };
    expect(preview.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(preview).not.toHaveProperty('url');
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
