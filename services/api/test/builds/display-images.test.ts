import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { makeDisplayImages } from '../../src/builds/display-images.js';

it('publishes sized and content-addressed images in all three formats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'display-images-'));
  try {
    await mkdir(join(root, 'media'));
    await sharp({ create: { width: 700, height: 350, channels: 4, background: '#f00' } })
      .png()
      .toFile(join(root, 'media', 'thumbnail.png'));
    const images = await makeDisplayImages(root);
    expect(await makeDisplayImages(root)).toEqual(images);
    const image = images['media/thumbnail.png']!;
    expect([image.width, image.height]).toEqual([700, 350]);
    for (const format of ['avif', 'webp', 'png'] as const) {
      expect(image.sources[format].map(({ width }) => width)).toEqual([320, 640, 700]);
      for (const entry of image.sources[format]) {
        const bytes = await readFile(join(root, entry.path));
        expect(entry.path).toBe(`media/ogm-variants/${createHash('sha256').update(bytes).digest('hex')}.${format}`);
        const metadata = await sharp(bytes).metadata();
        expect(metadata.width).toBe(entry.width);
        expect(metadata.format).toBe(format === 'avif' ? 'heif' : format);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('generates variants for both declared loading images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'display-loading-'));
  try {
    await mkdir(join(root, 'media'));
    for (const name of ['portrait.png', 'landscape.png'])
      await sharp({ create: { width: 320, height: 180, channels: 3, background: '#00f' } })
        .png()
        .toFile(join(root, 'media', name));
    const images = await makeDisplayImages(root, undefined, ['media/portrait.png', 'media/landscape.png']);
    for (const name of ['portrait.png', 'landscape.png'])
      expect(images[`media/${name}`]?.sources.avif[0]?.width).toBe(320);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('generates variants for declared slot paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'display-slots-'));
  try {
    await mkdir(join(root, 'media', 'tiles'), { recursive: true });
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#0f0' } })
      .png()
      .toFile(join(root, 'media', 'tiles', 'tile-portrait.png'));
    const images = await makeDisplayImages(root, undefined, [], ['media/tiles/tile-portrait.png']);
    expect(images['media/tiles/tile-portrait.png']?.sources.avif[0]?.path).toMatch(/[a-f0-9]{64}\.avif$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
