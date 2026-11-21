import { linkSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { IMAGE_SLOTS, type ViewportId } from '@ogm/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { composeSlots } from '../src/image-compose.js';
import { gm, tempDir } from './helpers.js';

async function png(root: string, path: string, width: number, height: number, color: string) {
  const file = join(root, 'public', path);
  mkdirSync(dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toFile(file);
}

function manifest(root: string, images: unknown) {
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify({ images }));
}

describe('layered image composition', () => {
  it('does nothing when the manifest has no image slots', async () => {
    const root = tempDir();
    manifest(root, undefined);
    expect(await composeSlots(root)).toEqual([]);
  });

  it('writes each required viewport at 2x size and keeps a square plate cover-scaled', async () => {
    const root = tempDir();
    await png(root, 'media/plate.png', 40, 20, '#0000ff');
    const marker = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ffffff' } })
      .png()
      .toBuffer();
    await sharp(join(root, 'public/media/plate.png'))
      .composite([{ input: marker, left: 16, top: 6 }])
      .png()
      .toFile(join(root, 'public/media/plate-marked.png'));
    writeFileSync(
      join(root, 'gm.manifest.json'),
      JSON.stringify({ images: { logo: { mode: 'layered', plate: 'media/plate-marked.png', layers: [] } } }),
    );

    const paths = await composeSlots(root);
    expect(paths).toHaveLength(IMAGE_SLOTS.logo.viewports.length);
    for (const viewport of IMAGE_SLOTS.logo.viewports) {
      const output = `media/slots/logo-${viewport}.png`;
      expect(paths).toContain(output);
      const metadata = await sharp(join(root, 'public', output)).metadata();
      const display = IMAGE_SLOTS.logo.display[viewport];
      expect(metadata.width).toBe(Math.round(display.width * 2));
      expect(metadata.height).toBe(Math.round(display.height * 2));
      const { data, info } = await sharp(join(root, 'public', output))
        .raw()
        .toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number) => (y * info.width + x) * info.channels;
      expect(data[at(0, Math.floor(info.height / 2)) + 3]).toBe(255);
      expect(data[at(0, Math.floor(info.height / 2)) + 2]).toBe(255);
      expect(data[at(Math.floor(info.width / 2), 0) + 2]).toBe(255);
      expect(data[at(Math.floor(info.width / 2), info.height - 1) + 2]).toBe(255);
      const white: number[] = [];
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const index = at(x, y);
          if (data[index] > 245 && data[index + 1] > 245 && data[index + 2] > 245) white.push(x, y);
        }
      }
      const xs = white.filter((_, index) => index % 2 === 0);
      const ys = white.filter((_, index) => index % 2 === 1);
      const markerWidth = Math.max(...xs) - Math.min(...xs) + 1;
      const markerHeight = Math.max(...ys) - Math.min(...ys) + 1;
      expect(Math.abs(markerWidth - markerHeight)).toBeLessThanOrEqual(1);
    }
  });

  it('places a layer center at the declared anchor within one output pixel', async () => {
    const root = tempDir();
    await png(root, 'media/plate.png', 30, 30, '#000000');
    await png(root, 'media/mark.png', 8, 4, '#00ff00');
    const viewport: ViewportId = 'phone-portrait';
    manifest(root, {
      logo: {
        mode: 'layered',
        plate: 'media/plate.png',
        layers: [{ src: 'media/mark.png', anchors: { [viewport]: { x: 0.5, y: 0.35, width: 0.8 } } }],
      },
    });

    await composeSlots(root);
    const output = join(root, 'public/media/slots/logo-phone-portrait.png');
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const green: number[] = [];
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const index = (y * info.width + x) * info.channels;
        if (data[index] === 0 && data[index + 1] === 255 && data[index + 2] === 0) green.push(x, y);
      }
    }
    const xs = green.filter((_, index) => index % 2 === 0);
    const ys = green.filter((_, index) => index % 2 === 1);
    const layerWidth = Math.max(...xs) - Math.min(...xs) + 1;
    const layerHeight = Math.max(...ys) - Math.min(...ys) + 1;
    const display = IMAGE_SLOTS.logo.display[viewport];
    const centerX = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys) + 1) / 2;
    expect(Math.abs(centerX - display.width * 2 * 0.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(centerY - display.height * 2 * 0.35)).toBeLessThanOrEqual(1);
    expect(Math.abs(layerWidth - Math.round(display.width * 2 * 0.8))).toBeLessThanOrEqual(1);
    expect(Math.abs(layerHeight - layerWidth / 2)).toBeLessThanOrEqual(1);
  });

  it('uses declared variant paths and refuses to replace a source image', async () => {
    const root = tempDir();
    await png(root, 'media/plate.png', 16, 16, '#123456');
    const variants = Object.fromEntries(
      IMAGE_SLOTS.logo.viewports.map((viewport) => [
        viewport,
        viewport === 'phone-portrait' ? 'media/custom-phone.png' : `media/custom-${viewport}.png`,
      ]),
    );
    manifest(root, {
      logo: {
        mode: 'layered',
        plate: 'media/plate.png',
        layers: [],
        variants,
      },
    });
    const paths = await composeSlots(root);
    expect(paths).toContain('media/custom-phone.png');
    expect(await sharp(join(root, 'public/media/custom-phone.png')).metadata()).toMatchObject({
      width: Math.round(IMAGE_SLOTS.logo.display['phone-portrait'].width * 2),
    });
    expect(await gm(['check', 'images'], { cwd: root })).toMatchObject({ code: 0, err: [] });

    manifest(root, {
      logo: {
        mode: 'layered',
        plate: 'media/plate.png',
        layers: [],
        variants: { 'phone-portrait': 'media/only-phone.png' },
      },
    });
    await expect(composeSlots(root)).rejects.toThrow('images.logo: missing variant for phone-landscape');

    manifest(root, {
      logo: {
        mode: 'layered',
        plate: 'media/plate.png',
        layers: [],
        variants: { ...variants, 'phone-portrait': 'media/plate.png' },
      },
    });
    await expect(composeSlots(root)).rejects.toThrow('output cannot replace a source image');
  });

  it('is available through the images compose command', async () => {
    const root = tempDir();
    await png(root, 'media/plate.png', 16, 16, '#123456');
    manifest(root, { logo: { mode: 'layered', plate: 'media/plate.png', layers: [] } });
    const composed = await gm(['images', 'compose'], { cwd: root });
    expect(composed.code).toBe(0);
    expect(composed.out).toContain('media/slots/logo-phone-portrait.png');
    expect(await gm(['check', 'images'], { cwd: root })).toMatchObject({ code: 0, err: [] });
    const json = await gm(['images', 'compose', '--json'], { cwd: root });
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out[0]!)).toMatchObject({
      paths: expect.arrayContaining(['media/slots/logo-phone-portrait.png']),
    });
  });

  it('refuses a symlinked output without touching its target', async () => {
    const root = tempDir();
    const outside = join(root, 'outside.png');
    await png(root, 'media/plate.png', 16, 16, '#123456');
    await sharp({ create: { width: 2, height: 2, channels: 4, background: '#abcdef' } })
      .png()
      .toFile(outside);
    mkdirSync(join(root, 'public/media/slots'), { recursive: true });
    symlinkSync(outside, join(root, 'public/media/slots/logo-phone-portrait.png'));
    manifest(root, { logo: { mode: 'layered', plate: 'media/plate.png', layers: [] } });

    await expect(composeSlots(root)).rejects.toThrow('output path cannot be a symbolic link');
    expect(await sharp(outside).metadata()).toMatchObject({ width: 2, height: 2 });
    expect((await readFile(outside)).length).toBeGreaterThan(0);
  });

  it('refuses a hard-linked output without changing its other link', async () => {
    const root = tempDir();
    const outside = join(root, 'outside.png');
    await png(root, 'media/plate.png', 16, 16, '#123456');
    await sharp({ create: { width: 2, height: 2, channels: 4, background: '#abcdef' } })
      .png()
      .toFile(outside);
    mkdirSync(join(root, 'public/media/slots'), { recursive: true });
    linkSync(outside, join(root, 'public/media/slots/logo-phone-portrait.png'));
    manifest(root, { logo: { mode: 'layered', plate: 'media/plate.png', layers: [] } });
    const before = await readFile(outside);

    await expect(composeSlots(root)).rejects.toThrow('output path cannot be a hard link');
    expect(await readFile(outside)).toEqual(before);
  });

  it('does not create output directories through a symlinked ancestor', async () => {
    const root = tempDir();
    const outside = join(root, 'outside');
    mkdirSync(outside);
    await png(root, 'media/plate.png', 16, 16, '#123456');
    symlinkSync(outside, join(root, 'public/media/slots'));
    manifest(root, {
      logo: {
        mode: 'layered',
        plate: 'media/plate.png',
        layers: [],
        variants: Object.fromEntries(
          IMAGE_SLOTS.logo.viewports.map((viewport) => [
            viewport,
            viewport === 'phone-portrait' ? 'media/slots/nested/image.png' : `media/safe-${viewport}.png`,
          ]),
        ),
      },
    });

    await expect(composeSlots(root)).rejects.toThrow('output path must be inside public');
    expect(await readdir(outside)).toEqual([]);
  });

  it('does not allow a layered variant to overwrite another slot source', async () => {
    const root = tempDir();
    await png(root, 'media/plate.png', 16, 16, '#123456');
    await png(root, 'media/title.png', 8, 8, '#abcdef');
    manifest(root, {
      logo: {
        mode: 'layered',
        plate: 'media/plate.png',
        layers: [],
        variants: Object.fromEntries(
          IMAGE_SLOTS.logo.viewports.map((viewport) => [
            viewport,
            viewport === 'phone-portrait' ? 'media/title.png' : `media/logo-${viewport}.png`,
          ]),
        ),
      },
      title: { mode: 'per-ratio', variants: { desktop: 'media/title.png' } },
    });

    await expect(composeSlots(root)).rejects.toThrow('output cannot replace a source image');
  });

  it('rejects a public directory that resolves outside the game', async () => {
    const root = tempDir();
    const outside = join(root, 'outside');
    mkdirSync(join(outside, 'media'), { recursive: true });
    await sharp({ create: { width: 16, height: 16, channels: 4, background: '#123456' } })
      .png()
      .toFile(join(outside, 'media/plate.png'));
    symlinkSync(outside, join(root, 'public'));
    manifest(root, { logo: { mode: 'layered', plate: 'media/plate.png', layers: [] } });

    await expect(composeSlots(root)).rejects.toThrow('public: must be a directory inside the game');
  });
});
