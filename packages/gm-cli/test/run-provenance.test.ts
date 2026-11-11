import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  captureMetadataPath,
  captureOutputPaths,
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

it('records a declared untracked custom capture output', () => {
  const root = tempDir('gm-custom-capture-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  git('init', '-q');
  writeFileSync(join(root, 'game.ts'), 'game');
  git('add', 'game.ts');
  git('commit', '-qm', 'game');
  const source = cleanHead(root)!;
  mkdirSync(join(root, 'captures'));
  const frame = join(root, 'captures/t2.png');
  writeFileSync(frame, 'frame');
  writeFileSync(join(root, 'captures/timeline.png'), 'timeline');
  writeFileSync(join(root, 'captures/state.json'), '{}');
  writeFileSync(join(root, 'captures/report.json'), '{}');
  expect(captureOutputPaths(root, join(root, 'captures'))).toEqual([]);
  recordRunProvenance(root, join(root, 'captures/report.json'), [{ path: 't2.png' }], source, ['timeline.png']);
  const metadata = JSON.parse(readFileSync(captureMetadataPath(root, frame), 'utf8'));
  expect(metadata.source).toBe(source);
  expect(Object.keys(metadata.outputs).sort()).toEqual([
    'captures/report.json',
    'captures/state.json',
    'captures/t2.png',
    'captures/timeline.png',
  ]);
  let builds = 0;
  expect(
    prepareVerifiedSource(
      root,
      () => {
        builds += 1;
      },
      captureOutputPaths(root, join(root, 'captures')),
    ),
  ).toBe(source);
  expect(builds).toBe(1);
  writeFileSync(frame, 'changed after capture');
  expect(() => prepareVerifiedSource(root, () => {}, captureOutputPaths(root, join(root, 'captures')))).toThrow(
    'committed tracked changes',
  );
  writeFileSync(frame, 'frame');
  writeFileSync(join(root, 'captures/unrelated.json'), '{}');
  expect(() => prepareVerifiedSource(root, () => {}, captureOutputPaths(root, join(root, 'captures')))).toThrow(
    'committed tracked changes',
  );
});

it('refuses verified output in a build input directory', async () => {
  const root = tempDir('gm-unsafe-out-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  const result = await gm(['run', '--verify-source', '--out', 'public'], { cwd: root });
  expect(result.code).toBe(2);
  expect(result.err.join('\n')).toContain('outside build input directories');
  const design = await gm(['run', '--verify-source', '--out', 'design'], { cwd: root });
  expect(design.code).toBe(2);
  expect(design.err.join('\n')).toContain('outside build input directories');
  mkdirSync(join(root, 'public'));
  symlinkSync('public', join(root, 'captures'));
  const linked = await gm(['run', '--verify-source', '--out', 'captures'], { cwd: root });
  expect(linked.code).toBe(2);
  expect(linked.err.join('\n')).toContain('cannot traverse a symlink');
});
