import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { compareGlass, compareGlassScreen } from './compare.js';

it('writes evidence and enforces the parity thresholds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ogm-glass-parity-'));
  try {
    const make = (color: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
        .png()
        .toBuffer();
    const black = await make('#000');
    const white = await make('#fff');
    const masks = join(dir, 'masks.json');
    await writeFile(masks, JSON.stringify({ Home: [] }));
    await expect(compareGlassScreen(black, black, dir, masks, 'Settings')).rejects.toThrow('No reviewed mask entry');
    expect((await compareGlassScreen(black, black, dir, masks, 'Home')).pass).toBe(true);
    expect(await readFile(join(dir, 'checklist.md'), 'utf8')).toContain('- [ ] Safe areas — crop: _required_');
    expect((await compareGlass(black, black, dir, [])).pass).toBe(true);
    expect((await compareGlass(black, white, dir, [])).pass).toBe(false);
    expect(JSON.parse(await readFile(join(dir, 'score.json'), 'utf8')).deltaEOver3Percent).toBe(100);
    expect((await sharp(join(dir, 'side-by-side.png')).metadata()).width).toBe(16);
    expect((await sharp(join(dir, 'heatmap.png')).metadata()).width).toBe(8);
    await expect(compareGlass(black, await sharp(white).resize(4, 4).png().toBuffer(), dir, [])).rejects.toThrow(
      'identical dimensions',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('requires both the SSIM and colour thresholds independently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ogm-glass-thresholds-'));
  try {
    const make = (color: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
        .png()
        .toBuffer();
    const colourOnly = await compareGlass(await make('#808080'), await make('#8c8c8c'), dir, []);
    expect(colourOnly.ssim).toBeGreaterThanOrEqual(0.97);
    expect(colourOnly.deltaEOver3Percent).toBeGreaterThan(1);
    expect(colourOnly.pass).toBe(false);
    expect(JSON.parse(await readFile(join(dir, 'score.json'), 'utf8')).pass).toBe(false);
    const structureOnly = await compareGlass(await make('#000000'), await make('#080808'), dir, []);
    expect(structureOnly.ssim).toBeLessThan(0.97);
    expect(structureOnly.deltaEOver3Percent).toBeLessThanOrEqual(1);
    expect(structureOnly.pass).toBe(false);
    expect(JSON.parse(await readFile(join(dir, 'score.json'), 'utf8')).pass).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
