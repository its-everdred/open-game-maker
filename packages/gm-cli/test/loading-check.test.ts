import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { checkLoading } from '../src/loading-check.js';
import { tempDir } from './helpers.js';

async function image(path: string, width: number, height: number) {
  await sharp({ create: { width, height, channels: 3, background: 'black' } })
    .png()
    .toFile(path);
}

describe('loading artwork validation', () => {
  it('accepts absent artwork and valid sources, and rejects invalid or missing images', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'public/media'), { recursive: true });
    const manifest = (loading?: unknown) => writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ loading }));
    manifest();
    expect(await checkLoading(root)).toEqual([]);
    manifest({ portrait: 'media/p.png', landscape: 'media/l.png' });
    expect(await checkLoading(root)).toHaveLength(2);
    await image(join(root, 'public/media/p.png'), 1440, 2560);
    await image(join(root, 'public/media/l.png'), 2560, 1440);
    expect(await checkLoading(root)).toEqual([]);
    await image(join(root, 'public/media/l.png'), 2560, 1500);
    expect(await checkLoading(root)).toEqual([expect.stringContaining('16:9')]);
    manifest({ portrait: '../outside.png' });
    expect(await checkLoading(root)).toHaveLength(2);
    await image(join(root, 'outside.png'), 1440, 2560);
    symlinkSync(join(root, 'outside.png'), join(root, 'public/media/escape.png'));
    manifest({ portrait: 'media/escape.png', landscape: 'media/l.png' });
    expect(await checkLoading(root)).toContain('media/escape.png: loading image must be inside public');
  });
});
