import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { trackedTargetMatches, visualInputs } from '../src/look/scope.js';
import { tempDir } from './helpers.js';

it('rejects a retargeted intermediate directory symlink', () => {
  const root = tempDir('gm-target-chain-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  mkdirSync(join(root, 'design'));
  mkdirSync(join(root, 'review'));
  writeFileSync(join(root, 'review/play.png'), 'approved');
  symlinkSync('../review', join(root, 'design/targets'));
  git('add', '-A');
  git('commit', '-qm', 'target');
  const source = git('rev-parse', 'HEAD').trim();
  const hash = createHash('sha256').update('approved').digest('hex');
  expect(trackedTargetMatches(root, source, 'design/targets/play.png', hash)).toBe(true);
  rmSync(join(root, 'design/targets'));
  symlinkSync('../other', join(root, 'design/targets'));
  git('add', '-A');
  git('commit', '-qm', 'retarget');
  expect(trackedTargetMatches(root, source, 'design/targets/play.png', hash)).toBe(false);
  rmSync(join(root, 'design/targets'));
  git('add', '-A');
  git('commit', '-qm', 'delete link');
  expect(trackedTargetMatches(root, source, 'design/targets/play.png', hash)).toBe(false);
});

it('finds visual entrypoints and asset files outside named asset directories', () => {
  const root = tempDir('gm-visual-paths-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  writeFileSync(join(root, 'README.md'), 'base');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'design'));
  writeFileSync(join(root, 'src/game.ts'), 'presentation');
  writeFileSync(join(root, 'src/App.tsx'), 'presentation');
  writeFileSync(join(root, 'design/icon.png'), 'image');
  writeFileSync(join(root, 'gameplay.ts'), 'gameplay');
  git('add', '-A');
  git('commit', '-qm', 'changes');
  expect(Object.keys(visualInputs(root, root, base))).toEqual(['design/icon.png', 'src/App.tsx', 'src/game.ts']);
});
