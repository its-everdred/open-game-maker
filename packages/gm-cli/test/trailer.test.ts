import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { gm, tempDir } from './helpers.js';

const captured = vi.hoisted(() => ({ build: '', fps: 0, seconds: 0, menus: {} as unknown }));
vi.mock('@ogm/gm-verify', async (original) => {
  const real = await original<typeof import('@ogm/gm-verify')>();
  return {
    ...real,
    captureTrailer: async (options: Parameters<typeof real.captureTrailer>[0]) => {
      captured.build = options.serveDir;
      captured.fps = options.fps ?? 30;
      captured.seconds = options.script[0]!.seconds;
      captured.menus = options.menus;
      expect(readFileSync(join(options.serveDir, 'a', 'asset.txt'), 'utf8')).toBe('fresh');
      return [join(options.outDir, 'trailer-landscape.mp4'), join(options.outDir, 'trailer-landscape.frames.json')];
    },
  };
});

it('builds the named game in test mode with staged assets before recording', async () => {
  const root = tempDir('gm-trailer-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(
    join(root, 'gm.manifest.json'),
    JSON.stringify({ id: 'demo', menus: { selectors: ["[data-screen='title']"] } }),
  );
  writeFileSync(join(root, 'scenes.json'), JSON.stringify([{ seconds: 15 }]));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        prebuild: 'node stage.cjs',
        build: 'node build.cjs',
      },
    }),
  );
  writeFileSync(
    join(root, 'stage.cjs'),
    "const fs=require('fs');fs.mkdirSync('public/a',{recursive:true});fs.writeFileSync('public/a/asset.txt','fresh')",
  );
  writeFileSync(
    join(root, 'build.cjs'),
    "const fs=require('fs');const a=process.argv;if(!a.includes('--mode')||!a.includes('test'))process.exit(1);fs.cpSync('public',a.at(-1),{recursive:true})",
  );
  const result = await gm(['trailer', 'demo', '--script', 'scenes.json', '--out', 'media', '--fps', '15'], {
    cwd: root,
  });
  expect(result.code).toBe(0);
  expect(result.out.join('\n')).toContain('trailer-landscape.mp4');
  expect(captured).toMatchObject({ fps: 15, seconds: 15, menus: { selectors: ["[data-screen='title']"], routes: [] } });
  expect(existsSync(captured.build)).toBe(false);
  const json = await gm(['trailer', 'demo', '--script', 'scenes.json', '--out', 'media', '--json'], { cwd: root });
  expect(json.code).toBe(0);
  expect(json.out).toHaveLength(1);
  expect(JSON.parse(json.out[0]!)).toMatchObject({
    paths: [expect.stringContaining('trailer-landscape.mp4'), expect.stringContaining('trailer-landscape.frames.json')],
  });
}, 60_000);

it('checks the game media against the trailer standard and fails on a second cut', async () => {
  const root = tempDir('gm-trailer-check-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ id: 'demo' }));
  mkdirSync(join(root, 'public', 'media'), { recursive: true });
  writeFileSync(join(root, 'public', 'media', 'trailer-portrait.mp4'), '');
  const result = await gm(['trailer', 'demo', '--check', '--json'], { cwd: root });
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out[0]!)).toEqual({
    ok: false,
    failures: [
      'trailer-portrait.mp4 is a second trailer; a game ships only trailer-landscape.mp4',
      `trailer-landscape.mp4 is missing from ${join(root, 'public', 'media')}`,
    ],
  });
  const capture = await gm(['trailer', 'demo', '--check', '--out', 'media'], { cwd: root });
  expect(capture.code).toBe(2);
});

it('refuses a manifest whose menu markers are malformed', async () => {
  const root = tempDir('gm-trailer-menus-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ id: 'demo', menus: { selectors: '.menu' } }));
  const result = await gm(['trailer', 'demo', '--check'], { cwd: root });
  expect(result.code).toBe(2);
  expect(result.err.join('\n')).toContain('invalid menus in gm.manifest.json');
});
