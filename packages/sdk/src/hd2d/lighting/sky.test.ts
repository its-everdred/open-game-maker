import { describe, expect, it } from 'vitest';
import { sampleShaftIntensity } from './dapple.js';
import { renderLightField } from './field.js';
import { LightingPresetSchema, type LightingPreset } from './schema.js';
import { sampleCloudCover, sampleShaftBeams } from './sky.js';

const SHAFTS = { direction: 1.2, color: '#ffd77a', intensity: 0.6, count: 4, reach: 0.45, width: 0.035, pool: 0.8 };
const CLOUDS = { coverage: 0.45, scale: 0.5, speed: 0.02, shadow: 0.5, sun: 0.4 };

/** Peaks along a row: each beam crossing it is one. */
function peaks(row: number[]): number {
  let count = 0;
  for (let i = 1; i < row.length - 1; i += 1)
    if (row[i]! > 0.05 && row[i]! >= row[i - 1]! && row[i]! > row[i + 1]!) count += 1;
  return count;
}

describe('short sun shafts', () => {
  // Kevin: several smaller shafts, mostly in the top half of the screen, not one big ray down the whole view.
  for (const aspect of [16 / 9, 390 / 844])
    it(`draws count separate beams that stop in the upper half (aspect ${aspect.toFixed(2)})`, () => {
      const row = Array.from({ length: 400 }, (_, i) => sampleShaftBeams(SHAFTS, i / 399, 0.15, 0, aspect));
      expect(peaks(row)).toBe(SHAFTS.count);
      for (let y = 0.6; y <= 1; y += 0.05)
        for (let x = 0; x <= 1; x += 0.01) expect(sampleShaftBeams(SHAFTS, x, y, 0, aspect)).toBe(0);
    });

  // Kevin: each shaft should light a patch of pixels on the ground where it lands.
  it('ends each beam in a lit pool brighter than the beam above it', () => {
    const withPool = (x: number, y: number) => sampleShaftBeams(SHAFTS, x, y, 0, 16 / 9);
    const noPool = (x: number, y: number) => sampleShaftBeams({ ...SHAFTS, pool: 0 }, x, y, 0, 16 / 9);
    // The brightest point of the lower half of the beams' range is a pool, and it disappears without pools.
    let best = { x: 0, y: 0, value: 0 };
    for (let y = 0.2; y <= 0.5; y += 0.005)
      for (let x = 0; x <= 1; x += 0.005) {
        const value = withPool(x, y);
        if (value > best.value) best = { x, y, value };
      }
    expect(best.value).toBeGreaterThan(withPool(best.x, best.y - 0.12) + 0.1);
    expect(noPool(best.x, best.y)).toBeLessThan(best.value / 2);
  });

  it('keeps the single wide wash when count is not set', () => {
    const wash = { direction: SHAFTS.direction, color: SHAFTS.color, intensity: SHAFTS.intensity };
    const preset: LightingPreset = { ambient: { color: '#ffffff', intensity: 1 }, shafts: wash };
    // The wash reaches the lower half; short beams never do.
    let lower = 0;
    for (let x = 0; x <= 1; x += 0.01) lower = Math.max(lower, sampleShaftIntensity(preset, x, 0.7, 0));
    expect(lower).toBeGreaterThan(0.05);
  });
});

describe('cloud shadows', () => {
  function coverShare(coverage: number, timeMs = 0): number {
    let covered = 0;
    let total = 0;
    for (let y = 0; y < 1; y += 0.02)
      for (let x = 0; x < 1; x += 0.02) {
        total += 1;
        if (sampleCloudCover({ ...CLOUDS, coverage }, x, y, timeMs, 16 / 9, 3) > 0.5) covered += 1;
      }
    return covered / total;
  }

  // Kevin: cloud cover that shades the ground, with sunny spots between.
  it('shades about the coverage share of the ground and leaves the rest sunny', () => {
    expect(coverShare(0)).toBe(0);
    expect(coverShare(0.45)).toBeGreaterThan(0.25);
    expect(coverShare(0.45)).toBeLessThan(0.65);
    expect(coverShare(0.8)).toBeGreaterThan(coverShare(0.45));
  });

  it('drifts over time and repeats for a seed', () => {
    const at = (timeMs: number, seed: number) =>
      Array.from({ length: 50 }, (_, i) => sampleCloudCover(CLOUDS, i / 49, 0.5, timeMs, 16 / 9, seed));
    expect(at(0, 3)).toEqual(at(0, 3));
    expect(at(20_000, 3)).not.toEqual(at(0, 3));
    expect(at(0, 4)).not.toEqual(at(0, 3));
  });

  it('darkens the light field under a cloud and brightens it in the sun', () => {
    const preset: LightingPreset = { ambient: { color: '#ffffff', intensity: 1 }, clouds: CLOUDS };
    const [width, height] = [80, 45];
    const out = new Uint8ClampedArray(width * height * 4);
    renderLightField(out, width, height, preset, 0, 3, []);
    let shaded = { keep: 255, light: 0 };
    let sunny = { keep: 0, light: 0 };
    for (let i = 0; i < width * height; i += 1) {
      const keep = out[i * 4 + 3]!;
      const light = out[i * 4]!;
      if (keep < shaded.keep) shaded = { keep, light };
      if (keep > sunny.keep || (keep === sunny.keep && light > sunny.light)) sunny = { keep, light };
    }
    expect(shaded.keep).toBeLessThan(255 * (1 - CLOUDS.shadow * 0.8));
    expect(sunny.keep).toBe(255);
    expect(sunny.light).toBeGreaterThan(shaded.light + 40);
  });
});

describe('sky preset fields', () => {
  it('accepts short beams and clouds, and rejects zero beams', () => {
    const base = { ambient: { color: '#ffffff', intensity: 1 } };
    expect(LightingPresetSchema.safeParse({ ...base, shafts: SHAFTS, clouds: CLOUDS }).success).toBe(true);
    expect(LightingPresetSchema.safeParse({ ...base, shafts: { ...SHAFTS, count: 0 } }).success).toBe(false);
    expect(LightingPresetSchema.safeParse({ ...base, clouds: { ...CLOUDS, coverage: 2 } }).success).toBe(false);
  });
});
