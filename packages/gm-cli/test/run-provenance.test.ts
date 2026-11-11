import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  captureMetadataPath,
  cleanHead,
  prepareVerifiedSource,
  recordRunProvenance,
} from '../src/look/run-provenance.js';
import { gm, tempDir } from './helpers.js';

it('records capture provenance only when the committed source stays clean', () => {
  const root = tempDir('gm-capture-source-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  writeFileSync(join(root, 'game.ts'), 'game');
  git('add', 'game.ts');
  git('commit', '-qm', 'game');
  mkdirSync(join(root, 'shots'));
  writeFileSync(join(root, 'shots/t2.png'), 'old frame');
  git('add', 'shots/t2.png');
  git('commit', '-qm', 'add old frame');
  const source = cleanHead(root)!;
  writeFileSync(join(root, 'shots/t2.png'), 'frame');
  recordRunProvenance(root, join(root, 'shots/report.json'), [{ path: 't2.png' }], source);
  const metadata = JSON.parse(readFileSync(captureMetadataPath(root, join(root, 'shots/t2.png')), 'utf8'));
  expect(metadata.source).toBe(source);
  expect(metadata.blob).toMatch(/^[a-f0-9]{40}$/);
  expect(metadata.outputs).toEqual({ 'shots/t2.png': metadata.blob });
  writeFileSync(join(root, 'game.ts'), 'dirty');
  writeFileSync(join(root, 'shots/t2.png'), 'new frame');
  recordRunProvenance(root, join(root, 'shots/report.json'), [{ path: 't2.png' }], source);
  expect(JSON.parse(readFileSync(captureMetadataPath(root, join(root, 'shots/t2.png')), 'utf8'))).toEqual(metadata);
});

it('builds the clean commit before issuing a source attestation', () => {
  const root = tempDir('gm-build-source-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  writeFileSync(join(root, 'game.ts'), 'game');
  git('add', 'game.ts');
  git('commit', '-qm', 'game');
  let builds = 0;
  const source = prepareVerifiedSource(root, () => {
    builds += 1;
  });
  expect(builds).toBe(1);
  expect(source).toBe(git('rev-parse', 'HEAD').trim());
  writeFileSync(join(root, '.gitignore'), 'public/*.png\n');
  git('add', '.gitignore');
  git('commit', '-qm', 'ignore assets');
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'public/logo.png'), 'untracked visual input');
  expect(() =>
    prepareVerifiedSource(root, () => {
      builds += 1;
    }),
  ).toThrow('committed tracked changes');
  expect(builds).toBe(1);
  git('add', '-f', 'public/logo.png');
  git('commit', '-qm', 'add asset');
  expect(() =>
    prepareVerifiedSource(root, () => {
      writeFileSync(join(root, 'game.ts'), 'modified');
    }),
  ).toThrow('source changed during the build');
});

it('rejects dirty and untracked sibling workspace inputs', () => {
  const root = tempDir('gm-workspace-source-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  mkdirSync(join(root, 'games/game'), { recursive: true });
  mkdirSync(join(root, 'packages/shared/src'), { recursive: true });
  writeFileSync(join(root, 'games/game/main.ts'), 'game');
  writeFileSync(join(root, 'packages/shared/src/view.ts'), 'shared');
  git('add', '-A');
  git('commit', '-qm', 'workspace');
  const game = join(root, 'games/game');
  expect(cleanHead(game)).toBeTruthy();
  writeFileSync(join(root, 'packages/shared/src/view.ts'), 'dirty');
  expect(cleanHead(game)).toBeUndefined();
  git('add', '-A');
  git('commit', '-qm', 'shared');
  writeFileSync(join(root, 'packages/shared/src/new.css'), 'untracked');
  expect(cleanHead(game)).toBeUndefined();
});

it('refuses source-verified capture of an independently served URL', async () => {
  const result = await gm(['run', '--verify-source', '--url', 'http://127.0.0.1:43171']);
  expect(result.code).toBe(2);
  expect(result.err.join('\n')).toContain('source verification requires the local game build');
});
