import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { gm, tempDir } from './helpers.js';

const captured = vi.hoisted(() => ({ build: '', fps: 0, seconds: 0 }));
vi.mock('@ogm/gm-verify', async (original) => {
  const real = await original<typeof import('@ogm/gm-verify')>();
  return {
    ...real,
    captureTrailer: async (options: Parameters<typeof real.captureTrailer>[0]) => {
      captured.build = options.serveDir;
      captured.fps = options.fps ?? 30;
      captured.seconds = options.script[0]!.seconds;
      expect(readFileSync(join(options.serveDir, 'a', 'asset.txt'), 'utf8')).toBe('fresh');
      return [join(options.outDir, 'trailer-portrait.mp4'), join(options.outDir, 'trailer-landscape.mp4')];
    },
  };
});

it('builds the named game in test mode with staged assets before recording', async () => {
  const root = tempDir('gm-trailer-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ id: 'demo' }));
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
  expect(result.out.join('\n')).toContain('trailer-portrait.mp4');
  expect(captured).toMatchObject({ fps: 15, seconds: 15 });
  expect(existsSync(captured.build)).toBe(false);
}, 60_000);
