import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { glassDiffBase } from '../../tools/glass-git-base.mjs';

it('uses the event base when a CI checkout has no origin/main ref', async () => {
  const root = await mkdtemp(join(tmpdir(), 'glass-base-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'source'), 'base');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    await writeFile(join(root, 'source'), 'changed');
    git('commit', '-qam', 'changed');
    const event = join(root, 'event.json');
    await writeFile(event, JSON.stringify({ pull_request: { base: { sha: base } } }));
    expect(glassDiffBase(root, { CI: 'true', GITHUB_EVENT_PATH: event })).toBe(`${base}..HEAD`);
    expect(git('diff', '--name-only', glassDiffBase(root, { CI: 'true', GITHUB_EVENT_PATH: event }))).toBe('source');
    await writeFile(event, JSON.stringify({ before: 'not-a-sha' }));
    expect(() => glassDiffBase(root, { CI: 'true', GITHUB_EVENT_PATH: event })).toThrow('valid event base SHA');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('selects the PR head instead of unrelated changes in the merge checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'glass-merge-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    await writeFile(join(root, 'base'), 'base');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    await writeFile(join(root, 'branch'), 'branch');
    git('add', '.');
    git('commit', '-qm', 'branch');
    const head = git('rev-parse', 'HEAD');
    await writeFile(join(root, 'other'), 'newer main');
    git('add', '.');
    git('commit', '-qm', 'merge checkout');
    const event = join(root, 'event.json');
    await writeFile(event, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }));
    expect(git('diff', '--name-only', glassDiffBase(root, { CI: 'true', GITHUB_EVENT_PATH: event }))).toBe('branch');
    await writeFile(event, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: '0'.repeat(40) } } }));
    expect(() => glassDiffBase(root, { CI: 'true', GITHUB_EVENT_PATH: event })).toThrow('valid event head SHA');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('fetches a missing event base into a shallow checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'glass-shallow-'));
  const source = join(root, 'source');
  const checkout = join(root, 'checkout');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(source);
    git(source, 'init', '-q');
    git(source, 'config', 'user.name', 'Test');
    git(source, 'config', 'user.email', 'test@example.com');
    await writeFile(join(source, 'file'), 'base');
    git(source, 'add', '.');
    git(source, 'commit', '-qm', 'base');
    const base = git(source, 'rev-parse', 'HEAD');
    await writeFile(join(source, 'file'), 'changed');
    git(source, 'commit', '-qam', 'change');
    git(root, 'clone', '-q', '--depth=1', `file://${source}`, checkout);
    expect(() => git(checkout, 'cat-file', '-e', `${base}^{commit}`)).toThrow();
    const event = join(root, 'event.json');
    await writeFile(event, JSON.stringify({ pull_request: { base: { sha: base } } }));
    const diff = glassDiffBase(checkout, { CI: 'true', GITHUB_EVENT_PATH: event });
    expect(git(checkout, 'diff', '--name-only', diff)).toBe('file');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
