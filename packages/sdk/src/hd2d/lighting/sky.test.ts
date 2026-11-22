import { describe, expect, it } from 'vitest';
import { sampleShaftIntensity } from './dapple.js';
import { renderLightField } from './field.js';
import { LightingPresetSchema, type LightingPreset } from './schema.js';
import { beamsAt, presetUnder, sampleCloudCover, sampleShaftBeams, shaftsActive } from './sky.js';

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

describe('random shafts (Kevin: random place, length, brightness; need not touch the ground)', () => {
  const RANDOM = { ...SHAFTS, count: 3, cycle: 6, chance: 0.8 };
  const seen = Array.from({ length: 120 }, (_, i) => beamsAt(RANDOM, i * 1000, 16 / 9)).flat();

  it('moves beams to new places, lengths and brightness over time', () => {
    // Across the screen and down it, independently: a beam does not just slide along a fixed line.
    expect(new Set(seen.map((beam) => beam.x.toFixed(2))).size).toBeGreaterThan(RANDOM.count * 6);
    expect(new Set(seen.map((beam) => beam.y.toFixed(2))).size).toBeGreaterThan(RANDOM.count * 6);
    expect(new Set(seen.map((beam) => beam.brightness.toFixed(2))).size).toBeGreaterThan(5);
    // Lengths vary, all within reach: the shafts still stay in the top half.
    const ends = seen.map((beam) => beam.y);
    expect(Math.max(...ends) - Math.min(...ends)).toBeGreaterThan(RANDOM.reach * 0.4);
    expect(Math.max(...ends)).toBeLessThanOrEqual(RANDOM.reach);
  });

  it('lights a ground patch only under the beams that reach the ground', () => {
    const grounded = seen.filter((beam) => beam.grounded);
    expect(grounded.length).toBeGreaterThan(0);
    expect(grounded.length).toBeLessThan(seen.length);
    const at = (time: number) => beamsAt(RANDOM, time, 16 / 9);
    // At a moment with one fully shown beam of each kind, only the grounded one has a patch where it ends.
    for (let time = 0; time < 120_000; time += 250) {
      const shown = at(time).filter((beam) => beam.fade > 0.99);
      const air = shown.find((beam) => !beam.grounded);
      const ground = shown.find((beam) => beam.grounded);
      if (!air || !ground) continue;
      const withPool = (beam: { x: number; y: number }) => sampleShaftBeams(RANDOM, beam.x, beam.y, time, 16 / 9);
      const noPool = (beam: { x: number; y: number }) =>
        sampleShaftBeams({ ...RANDOM, pool: 0 }, beam.x, beam.y, time, 16 / 9);
      expect(withPool(ground)).toBeGreaterThan(noPool(ground) + 0.05);
      expect(withPool(air)).toBeCloseTo(noPool(air), 6);
      return;
    }
    throw new Error('no moment showed a grounded and an airborne beam together');
  });

  it('fades beams in and out, and shows none at chance 0', () => {
    const fades = seen.map((beam) => beam.fade);
    expect(Math.min(...fades)).toBeLessThan(0.2);
    expect(Math.max(...fades)).toBeCloseTo(1, 2);
    expect(Array.from({ length: 60 }, (_, i) => beamsAt({ ...RANDOM, chance: 0 }, i * 1000, 16 / 9)).flat()).toEqual(
      [],
    );
  });
});

describe('shafts by biome and weather', () => {
  const when = { ...SHAFTS, when: { biomes: ['forest'], weather: ['clear', 'partly-cloudy'] } };

  it('shows shafts only where the biome and the weather both match', () => {
    expect(shaftsActive(when, { biome: 'forest', weather: 'clear' })).toBe(true);
    expect(shaftsActive(when, { biome: 'forest', weather: 'rain' })).toBe(false);
    expect(shaftsActive(when, { biome: 'desert', weather: 'clear' })).toBe(false);
    expect(shaftsActive(when, {})).toBe(false);
    expect(shaftsActive(SHAFTS, {})).toBe(true);
  });

  it('darkens the shafts in the rendered preset, keeping the same copy each frame', () => {
    const preset: LightingPreset = { ambient: { color: '#ffffff', intensity: 1 }, shafts: when, clouds: CLOUDS };
    const rain = presetUnder(preset, { biome: 'forest', weather: 'rain' });
    expect(beamsAt(rain.shafts!, 0, 16 / 9)).toEqual([]);
    expect(sampleShaftBeams(rain.shafts!, 0.5, 0.2, 0, 16 / 9)).toBe(0);
    // The sun keeps its colour: it also tints the dapple and the sunny gaps between clouds.
    expect(rain.shafts!.color).toBe(when.color);
    expect(rain.clouds).toBe(CLOUDS);
    expect(presetUnder(preset, { biome: 'forest', weather: 'rain' })).toBe(rain);
    expect(presetUnder(preset, { biome: 'forest', weather: 'clear' })).toBe(preset);
  });
});
