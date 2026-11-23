import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AssetsLock } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { cacheIdentity } from '../src/commands/build/assets/cache.js';
import { planBuild } from '../src/commands/build/assets/plan.js';
import { tempDir } from './helpers.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('pixel-art image cache key', () => {
  // Pixel-art images over 2048 px used to be downscaled; a cache hit on such a build would bring the blur back.
  it('differs from the key of builds made while pixel art was still downscaled', async () => {
    const cwd = tempDir('gm-build-pixel-cache-');
    writeFileSync(join(cwd, 'tileset.png'), ONE_PIXEL_PNG);
    const lock = {
      version: 1,
      family: 'pixel-art',
      pov: 'side',
      assets: [
        {
          id: 't3:fixture/tileset',
          sha256: createHash('sha256').update(ONE_PIXEL_PNG).digest('hex'),
          path: 'tileset.png',
          license: 'CC0-1.0',
          rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: null },
          added: '2026-11-02',
        },
      ],
    } as AssetsLock;

    const { jobs } = await planBuild(lock, ['desktop'], join(cwd, '.gm/cache/assets'), {
      cwd,
      assetsRoot: null,
      blobRoot: null,
    });
    const job = jobs[0]!;
    const downscalingRecipe = { ...job.recipe };
    delete downscalingRecipe.unscaled;

    expect((await cacheIdentity(job)).key).not.toBe((await cacheIdentity({ ...job, recipe: downscalingRecipe })).key);
  });
});
