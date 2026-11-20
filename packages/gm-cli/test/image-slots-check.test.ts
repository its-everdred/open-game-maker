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

  it('allows exactly one percent aspect variance and rejects values beyond it', async () => {
    const root = tempDir();
    await image(root, 'media/logo.png', 101, 100);
    manifest(root, { logo: 'media/logo.png' });
    expect(await checkImageSlots(root)).toEqual([]);
    await image(root, 'media/logo.png', 102, 100);
    expect((await checkImageSlots(root)).some((error) => error.includes('logo desktop is 102:100'))).toBe(true);
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

  it('rejects vertical clipping caused by a tall layer source', async () => {
    const root = tempDir();
    await image(root, 'media/tall.png', 100, 300);
    await image(root, 'media/output.png', 320, 320);
    const variants = Object.fromEntries(VIEWPORT_IDS.map((viewport) => [viewport, 'media/output.png']));
    manifest(root, {
      images: {
        logo: {
          mode: 'layered',
          variants,
          layers: [{ src: 'media/tall.png', anchors: { 'phone-portrait': { x: 0.5, y: 0.2, width: 0.3 } } }],
        },
      },
    });
    expect(await checkImageSlots(root)).toContain('media/tall.png: images.logo phone-portrait anchor leaves the safe area');
  });

  it('accepts a centered layer that exactly fits the safe margin', async () => {
    const root = tempDir();
    await image(root, 'media/layer.png', 100, 100);
    await image(root, 'media/output.png', 320, 320);
    const variants = Object.fromEntries(VIEWPORT_IDS.map((viewport) => [viewport, 'media/output.png']));
    const anchors = Object.fromEntries(VIEWPORT_IDS.map((viewport) => [viewport, { x: 0.5, y: 0.5, width: 0.9 }]));
    manifest(root, { images: { logo: { mode: 'layered', variants, layers: [{ src: 'media/layer.png', anchors }] } } });
    expect(await checkImageSlots(root)).toEqual([]);
    manifest(root, {
      images: {
        logo: {
          mode: 'layered',
          variants,
          layers: [{ src: 'media/layer.png', anchors: Object.fromEntries(VIEWPORT_IDS.map((viewport) => [viewport, { x: 0.5, y: 0.5, width: 0.9001 }])) }],
        },
      },
    });
    expect((await checkImageSlots(root)).some((error) => error.includes('anchor leaves the safe area'))).toBe(true);
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

  it('rejects malformed image rule overrides instead of weakening checks', async () => {
    const root = tempDir();
    const variants = await viewportVariants(root);
    manifest(root, {
      imageRules: { minTextPx: '16px' },
      images: { title: { mode: 'per-ratio', variants, text: { capHeight: 0.01 } } },
    });
    expect(await checkImageSlots(root)).toContain('gm.manifest.json: imageRules.minTextPx must be a finite number');
    manifest(root, { imageRules: { safeMargin: -0.05 }, images: { title: { mode: 'per-ratio', variants } } });
    expect(await checkImageSlots(root)).toContain('gm.manifest.json: imageRules.safeMargin is outside its valid range');
  });

  it('rejects phone text that is too small and applies distinct contrast thresholds and overrides', async () => {
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
          text: { capHeight: 0.05, color: '#666666', background: '#000000' },
        },
      },
    });
    const contrastErrors = await checkImageSlots(root);
    expect(contrastErrors).toEqual([
      'media/phone-landscape.png: title phone-landscape text contrast is below the required ratio',
    ]);
    manifest(root, {
      imageRules: { minContrastText: 3.5 },
      images: {
        title: {
          mode: 'per-ratio',
          variants,
          text: { capHeight: 0.05, color: '#666666', background: '#000000' },
        },
      },
    });
    expect(await checkImageSlots(root)).toEqual([]);
  });

  it('runs the standalone command with legacy sources and a complete viewport set', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'public/media'), { recursive: true });
    const variants = await viewportVariants(root, 'loading');
    manifest(root, { loading: { portrait: 'media/p.png', landscape: 'media/l.png' }, images: { loading: { mode: 'per-ratio', variants } } });
    await image(root, 'media/p.png', 1440, 2560);
    await image(root, 'media/l.png', 2560, 1440);
    expect(await gm(['check', 'images', '--json'], { cwd: root })).toEqual({
      code: 0,
      out: ['{"ok":true,"errors":[]}'],
      err: [],
    });
    const invalidArgs = await gm(['check', 'images', 'unexpected'], { cwd: root });
    expect(invalidArgs.code).toBe(2);
    expect(invalidArgs.err.join('\n')).toContain('gm help check images');
  });

  it('requires viewport variants when legacy loading artwork is shipped', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'public/media'), { recursive: true });
    manifest(root, { loading: { portrait: 'media/p.png', landscape: 'media/l.png' } });
    await image(root, 'media/p.png', 1440, 2560);
    await image(root, 'media/l.png', 2560, 1440);
    const result = await gm(['check', 'images', '--json'], { cwd: root });
    expect(result.code).toBe(1);
    expect(result.out[0]).toContain('images.loading: missing variant for phone-portrait');
  });

  it('uses EXIF-oriented dimensions when validating JPEG variants', async () => {
    const root = tempDir();
    const path = join(root, 'public/media/portrait.jpg');
    mkdirSync(dirname(path), { recursive: true });
    await sharp({ create: { width: 844, height: 390, channels: 3, background: 'black' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toFile(path);
    expect((await sharp(path).metadata()).autoOrient).toMatchObject({ width: 390, height: 844 });
    const variants = await viewportVariants(root);
    variants['phone-portrait'] = 'media/portrait.jpg';
    manifest(root, { images: { title: { mode: 'per-ratio', variants } } });
    expect(await checkImageSlots(root)).toEqual([]);
    await sharp({ create: { width: 844, height: 390, channels: 3, background: 'black' } }).jpeg().toFile(path);
    expect(await checkImageSlots(root)).toContain(
      'media/portrait.jpg: title phone-portrait is 844:390, needs the 390:844 display box',
    );
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
