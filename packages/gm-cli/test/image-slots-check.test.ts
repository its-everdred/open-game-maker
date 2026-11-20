import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { IMAGE_SLOTS, VIEWPORT_IDS } from '@ogm/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { checkImageSlots } from '../src/image-slots-check.js';
import { gm, tempDir } from './helpers.js';

async function image(root: string, name: string, width: number, height: number) {
  const path = join(root, 'public', name);
  mkdirSync(dirname(path), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: 'black' } }).png().toFile(path);
}

function manifest(root: string, data: unknown) {
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify(data));
}

async function viewportVariants(root: string, slot: keyof typeof IMAGE_SLOTS = 'title') {
  const variants: Record<string, string> = {};
  for (const viewport of VIEWPORT_IDS) {
    const display = IMAGE_SLOTS[slot].display[viewport];
    const path = `media/${viewport}.png`;
    await image(root, path, Math.round(display.width), Math.round(display.height));
    variants[viewport] = path;
  }
  return variants;
}

describe('creator-visible image slots', () => {
  it('accepts a game with no declared image slots', async () => {
    const root = tempDir();
    manifest(root, {});
    expect(await checkImageSlots(root)).toEqual([]);
  });

  it('reports a missing required viewport variant', async () => {
    const root = tempDir();
    await image(root, 'media/desktop.png', 1920, 1080);
    manifest(root, { images: { title: { mode: 'per-ratio', variants: { desktop: 'media/desktop.png' } } } });
    expect(await checkImageSlots(root)).toContain('images.title: missing variant for phone-portrait');
  });

  it('checks declared variants outside a slot’s required viewport list', async () => {
    const root = tempDir();
    const paths = await viewportVariants(root, 'tile');
    paths.desktop = 'media/missing-desktop.png';
    manifest(root, { images: { tile: { mode: 'per-ratio', variants: paths } } });
    expect(await checkImageSlots(root)).toContain('media/missing-desktop.png: images.tile desktop image is missing or unreadable');
  });

  it('rejects a stretched variant', async () => {
    const root = tempDir();
    await image(root, 'media/stretched.png', 1920, 1200);
    manifest(root, { images: { title: { mode: 'per-ratio', variants: { 'phone-portrait': 'media/stretched.png' } } } });
    expect((await checkImageSlots(root)).some((error) => error.includes('is 1920:1200'))).toBe(true);
  });

  it('rejects a layered anchor outside the safe area using center and source dimensions', async () => {
    const root = tempDir();
    await image(root, 'media/layer.png', 100, 100);
    manifest(root, {
      images: {
        title: {
          mode: 'layered',
          variants: {},
          layers: [{ src: 'media/layer.png', anchors: { 'phone-portrait': { x: 0.07, y: 0.5, width: 0.12 } } }],
        },
      },
    });
    expect(await checkImageSlots(root)).toContain('media/layer.png: images.title phone-portrait anchor leaves the safe area');
  });

  it('accepts complete per-ratio and layered output sets', async () => {
    const root = tempDir();
    const variants = await viewportVariants(root);
    manifest(root, { images: { title: { mode: 'per-ratio', variants } } });
    expect(await checkImageSlots(root)).toEqual([]);

    await image(root, 'media/plate.png', 500, 500);
    await image(root, 'media/mark.png', 100, 100);
    for (const viewport of VIEWPORT_IDS) {
      const display = IMAGE_SLOTS.title.display[viewport];
      await image(root, `media/slots/title-${viewport}.png`, Math.round(display.width), Math.round(display.height));
    }
    manifest(root, {
      images: {
        title: {
          mode: 'layered',
          plate: 'media/plate.png',
          layers: [{ src: 'media/mark.png', anchors: Object.fromEntries(VIEWPORT_IDS.map((viewport) => [viewport, { x: 0.5, y: 0.5, width: 0.3 }])) }],
        },
      },
    });
    expect(await checkImageSlots(root)).toEqual([]);
  });

  it('rejects malformed slot declarations', async () => {
    const root = tempDir();
    manifest(root, { images: [] });
    expect((await checkImageSlots(root)).some((error) => error.includes('images'))).toBe(true);
  });

  it('rejects phone text that is too small and text with low contrast', async () => {
    const root = tempDir();
    const variants = await viewportVariants(root);
    manifest(root, {
      images: {
        title: {
          mode: 'per-ratio',
          variants,
          text: { capHeight: 0.01, color: '#111111', background: '#000000' },
        },
      },
    });
    const errors = await checkImageSlots(root);
    expect(errors.some((error) => error.includes('text is') && error.includes('needs 16px'))).toBe(true);
    manifest(root, {
      images: {
        title: {
          mode: 'per-ratio',
          variants,
          text: { capHeight: 0.1, color: '#111111', background: '#000000' },
        },
      },
    });
    expect((await checkImageSlots(root)).some((error) => error.includes('contrast is below'))).toBe(true);
  });

  it('runs the standalone command and keeps legacy loading artwork on its two-ratio check', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'public/media'), { recursive: true });
    manifest(root, { loading: { portrait: 'media/p.png', landscape: 'media/l.png' } });
    await image(root, 'media/p.png', 1440, 2560);
    await image(root, 'media/l.png', 2560, 1440);
    expect(await gm(['check', 'images', '--json'], { cwd: root })).toEqual({
      code: 0,
      out: ['{"ok":true,"errors":[]}'],
      err: [],
    });
  });

  it('fails the standalone command for an incomplete image set', async () => {
    const root = tempDir();
    manifest(root, { images: { title: { mode: 'per-ratio', variants: {} } } });
    const result = await gm(['check', 'images', '--json'], { cwd: root });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out[0]!)).toMatchObject({ ok: false });
    expect(result.out[0]).toContain('missing variant for phone-portrait');
  });
});
