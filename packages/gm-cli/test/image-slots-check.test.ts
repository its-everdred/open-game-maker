import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { checkImageSlots } from '../src/image-slots-check.js';
import { tempDir } from './helpers.js';

async function image(root: string, name: string, width: number, height: number) {
  const path = join(root, 'public', name);
  mkdirSync(join(path, '..'), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: 'black' } }).png().toFile(path);
}

function manifest(root: string, data: unknown) {
  writeFileSync(join(root, 'gm.manifest.json'), JSON.stringify(data));
}

describe('creator-visible image slots', () => {
  it('accepts a game with no declared image slots', async () => {
    const root = tempDir();
    manifest(root, {});
    expect(await checkImageSlots(root)).toEqual([]);
  });

  it('reports one missing viewport variant', async () => {
    const root = tempDir();
    manifest(root, { images: { title: { mode: 'per-ratio', variants: { desktop: 'media/title.png' } } } });
    expect(await checkImageSlots(root)).toContain('images.title: missing variant for phone-portrait');
  });

  it('rejects a stretched variant', async () => {
    const root = tempDir();
    await image(root, 'media/title.png', 1920, 1200);
    manifest(root, { images: { title: { mode: 'per-ratio', variants: { 'phone-portrait': 'media/title.png', 'phone-landscape': 'media/title.png', 'tablet-portrait': 'media/title.png', 'tablet-landscape': 'media/title.png', desktop: 'media/title.png' } } } });
    expect((await checkImageSlots(root)).some((error) => error.includes('is 1920:1200'))).toBe(true);
  });

  it('rejects a layered anchor outside the safe area', async () => {
    const root = tempDir();
    manifest(root, { images: { title: { mode: 'layered', layers: [{ src: 'media/layer.png', anchors: { 'phone-portrait': { x: 0, y: 0.1, width: 0.5 } } }] } } });
    expect(await checkImageSlots(root)).toContain('media/layer.png: images.title phone-portrait anchor leaves the safe area');
  });

  it('rejects phone text that is too small and text with low contrast', async () => {
    const root = tempDir();
    await image(root, 'media/title.png', 390, 844);
    manifest(root, { images: { title: { mode: 'per-ratio', variants: { 'phone-portrait': 'media/title.png', 'phone-landscape': 'media/title.png', 'tablet-portrait': 'media/title.png', 'tablet-landscape': 'media/title.png', desktop: 'media/title.png' }, text: { capHeight: 0.01, color: '#111111', background: '#000000' } } } });
    const errors = await checkImageSlots(root);
    expect(errors.some((error) => error.includes('text is') && error.includes('needs 16px'))).toBe(true);
    manifest(root, { images: { title: { mode: 'per-ratio', variants: { 'phone-portrait': 'media/title.png', 'phone-landscape': 'media/title.png', 'tablet-portrait': 'media/title.png', 'tablet-landscape': 'media/title.png', desktop: 'media/title.png' }, text: { capHeight: 0.1, color: '#111111', background: '#000000' } } } });
    expect((await checkImageSlots(root)).some((error) => error.includes('contrast is below'))).toBe(true);
  });
});
