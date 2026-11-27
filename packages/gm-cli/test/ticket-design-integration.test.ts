import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { gm, tempDir } from './helpers.js';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    execFileSync: vi.fn((...args: Parameters<typeof original.execFileSync>) => {
      if (args[0] === 'gh') return JSON.stringify({ labels: [{ name: 'design:ogm-glass' }] });
      return original.execFileSync(...args);
    }),
  };
});

it('uses the issue design label when checking a creative mock', async () => {
  const cwd = tempDir();
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd });
  git('init', '-q');
  git('remote', 'add', 'origin', 'https://github.com/example/open-game-maker.git');
  writeFileSync(join(cwd, 'gm.manifest.json'), '{}');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  mkdirSync(join(cwd, 'review'), { recursive: true });
  writeFileSync(join(cwd, 'review/mock.png'), 'mock');
  writeFileSync(
    join(cwd, 'review/request.json'),
    JSON.stringify({
      kind: 'image',
      out: 'review',
      file: 'mock.png',
      refs: ['assets-local/packs/kit/a.png', 'assets-local/packs/kit/b.png'],
    }),
  );
  git('add', '-A');
  git('commit', '-qm', 'add mock');
  writeFileSync(join(cwd, 'pr.md'), 'Closes #123');
  const result = await gm(
    ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'mock'],
    {
      cwd,
    },
  );
  expect(result.err.join('\n')).toContain('needs an approved OGM glass design image reference');
  vi.mocked(execFileSync).mockClear();
  await gm(['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'build'], { cwd });
  expect(vi.mocked(execFileSync).mock.calls.some((call) => call[0] === 'gh')).toBe(false);
  vi.mocked(execFileSync).mockClear();
  await gm(
    ['check', '--body', 'pr.md', '--base', 'origin/main', '--lane', 'creative', '--phase', 'mock', '--design', 'none'],
    { cwd },
  );
  expect(vi.mocked(execFileSync).mock.calls.some((call) => call[0] === 'gh')).toBe(false);
});
