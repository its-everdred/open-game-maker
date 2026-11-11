import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { gm, tempDir } from './helpers.js';

describe('gm look score', () => {
  it('writes a sheet and ranks matching regions above changed regions', async () => {
    const cwd = tempDir('gm-score-');
    const target = Buffer.alloc(24 * 12 * 3, 80);
    const candidate = Buffer.from(target);
    for (let y = 0; y < 12; y++) for (let x = 12; x < 24; x++) candidate[(y * 24 + x) * 3] = 220;
    await sharp(target, { raw: { width: 24, height: 12, channels: 3 } })
      .png()
      .toFile(join(cwd, 'target.png'));
    await sharp(candidate, { raw: { width: 24, height: 12, channels: 3 } })
      .png()
      .toFile(join(cwd, 'candidate.png'));
    const result = await gm(
      ['look', 'score', 'target.png', 'candidate.png', '--region', 'same=0,0,12,12', '--region', 'changed=12,0,12,12'],
      { cwd },
    );
    expect(result.code).toBe(0);
    const cropped = await gm(
      ['look', 'score', 'candidate.png', 'candidate.png', '--crop', '12,0,12,12', '--out', 'crop.png'],
      { cwd },
    );
    expect(JSON.parse(cropped.out[0]!).overall.ssim).toBeCloseTo(1);
    expect(JSON.parse(cropped.out[0]!).worstRegions).toHaveLength(5);
    const scores = JSON.parse(result.out[0]!);
    expect(scores.worstRegions[0].name).toBe('changed');
    expect(scores.regions[0].ssim).toBeCloseTo(1);
    expect(scores.regions[1].ssim).toBeLessThan(1);
    expect((await sharp(join(cwd, 'look-score.png')).metadata()).width).toBe(96);
  });
  it('normalizes differently sized captures before applying a crop', async () => {
    const cwd = tempDir('gm-score-');
    const pixels = Buffer.alloc(20 * 20 * 3);
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) pixels[(y * 20 + x) * 3] = 255;
    await sharp(pixels, { raw: { width: 20, height: 20, channels: 3 } })
      .png()
      .toFile(join(cwd, 'a.png'));
    await sharp(pixels, { raw: { width: 20, height: 20, channels: 3 } })
      .resize(40, 40, { kernel: 'nearest' })
      .png()
      .toFile(join(cwd, 'b.png'));
    const result = await gm(['look', 'score', 'a.png', 'b.png', '--crop', '12,2,6,15'], { cwd });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!).overall.ssim).toBeGreaterThan(0.99);
  });
  it('does not hide a fully transparent candidate', async () => {
    const cwd = tempDir('gm-score-');
    await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toFile(join(cwd, 'opaque.png'));
    await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toFile(join(cwd, 'clear.png'));
    const result = await gm(['look', 'score', 'opaque.png', 'clear.png'], { cwd });
    expect(JSON.parse(result.out[0]!).overall.ssim).toBeLessThan(1);
  });
  it('runs a configured local perceptual adapter', async () => {
    const cwd = tempDir('gm-score-');
    await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toFile(join(cwd, 'a.png'));
    writeFileSync(join(cwd, 'adapter'), '#!/bin/sh\nprintf "0.25\\n"\n', { mode: 0o700 });
    const result = await gm(['look', 'score', 'a.png', 'a.png', '--perceptual', './adapter'], { cwd });
    expect(JSON.parse(result.out[0]!).perceptual.score).toBe(0.25);
  });
  it('refuses an output alias of an input', async () => {
    const cwd = tempDir('gm-score-');
    await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
      .png()
      .toFile(join(cwd, 'a.png'));
    symlinkSync('a.png', join(cwd, 'alias.png'));
    const result = await gm(['look', 'score', 'a.png', 'a.png', '--out', 'alias.png'], { cwd });
    expect(result.code).toBe(2);
    expect((await sharp(join(cwd, 'a.png')).metadata()).width).toBe(4);
  });
  it('rejects out-of-bounds regions', async () => {
    const cwd = tempDir('gm-score-');
    await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
      .png()
      .toFile(join(cwd, 'a.png'));
    const result = await gm(['look', 'score', 'a.png', 'a.png', '--region', 'bad=3,3,2,2'], { cwd });
    expect(result.code).toBe(2);
  });
});
