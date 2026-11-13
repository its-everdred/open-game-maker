import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { gm, tempDir } from './helpers.js';

const state = vi.hoisted(() => ({ served: [] as string[] }));
vi.mock('@ogm/gm-verify', async (original) => {
  const real = await original<typeof import('@ogm/gm-verify')>();
  return {
    ...real,
    serveStatic: async (dir: string) => {
      state.served.push(dir);
      return real.serveStatic(dir);
    },
    runVerify: async ({ url, outDir }: { url: string; outDir: string }) => {
      const asset = await fetch(new URL('/a/blob.png', url));
      expect(await asset.text()).toBe('staged asset');
      return { report: { verdict: 'pass', renderer: 'test', frames: [] }, reportPath: join(outDir, 'report.json') };
    },
  };
});

it('builds test mode with staged ignored assets and serves it for subsequent runs', async () => {
  const root = tempDir('gm-test-build-');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root });
  git('init', '-q');
  writeFileSync(join(root, '.gitignore'), 'public/a/\ndist/\n');
  writeFileSync(join(root, 'gm.manifest.json'), '{}');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { prebuild: 'node stage.cjs', build: 'node build.cjs vite build --mode published' } }),
  );
  writeFileSync(
    join(root, 'stage.cjs'),
    "const fs = require('fs'); fs.mkdirSync('public/a', {recursive:true}); fs.writeFileSync('public/a/blob.png', 'staged asset');",
  );
  writeFileSync(
    join(root, 'build.cjs'),
    "const fs = require('fs'); const args = process.argv; if (args.slice(-4, -2).join(' ') !== '--mode test') process.exit(1); const out = args.at(-1); fs.cpSync('public', out, {recursive:true}); fs.writeFileSync(out + '/index.html', 'test');",
  );
  git('add', '-A');
  git('commit', '-qm', 'game');
  mkdirSync(join(root, 'public/a'), { recursive: true });
  writeFileSync(join(root, 'public/a/blob.png'), 'stale staged asset');
  mkdirSync(join(root, 'dist/a'), { recursive: true });
  writeFileSync(join(root, 'dist/a/blob.png'), 'stale published asset');
  const results = [
    await gm(['run', '--verify-source', '--frames', '0,2,5'], { cwd: root }),
    await gm(['run', '--frames', '0,2,5'], { cwd: root }),
  ];
  expect(results.map((result) => result.code)).toEqual([0, 0]);
  expect(new Set(state.served).size).toBe(2);
  expect(state.served.every((dir) => !existsSync(dir))).toBe(true);
}, 60_000);
