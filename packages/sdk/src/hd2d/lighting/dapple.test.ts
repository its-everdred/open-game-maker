import { describe, expect, it } from 'vitest';
import { renderDappleMask, sampleShaftIntensity } from './dapple.js';
import { DEFAULT_FOREST_LIGHTING } from './schema.js';

function fnv1aHex(bytes: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

describe('dapple and shaft sampling', () => {
  it('matches deterministic 64x64 mask snapshots', () => {
    const settings = { scale: 0.25, speed: 0.08, intensity: 0.53 };
    const atStart = renderDappleMask(settings, { width: 64, height: 64, timeMs: 0, seed: 1 });
    const afterOneSecond = renderDappleMask(settings, { width: 64, height: 64, timeMs: 1000, seed: 1 });
    expect(fnv1aHex(atStart)).toMatchInlineSnapshot(`"05d551ed"`);
    expect(fnv1aHex(afterOneSecond)).toMatchInlineSnapshot(`"8629afb0"`);
    expect(fnv1aHex(atStart)).toBe(fnv1aHex(renderDappleMask(settings, { width: 64, height: 64, timeMs: 0, seed: 1 })));
    expect(fnv1aHex(atStart)).not.toBe(fnv1aHex(afterOneSecond));
  });

  it('returns no shaft contribution without a shaft preset and bounds its output', () => {
    expect(sampleShaftIntensity(DEFAULT_FOREST_LIGHTING, 0, 0, 0)).toBeGreaterThanOrEqual(0);
    expect(sampleShaftIntensity(DEFAULT_FOREST_LIGHTING, 0, 0, 0)).toBeLessThanOrEqual(1);
    expect(sampleShaftIntensity({ ambient: DEFAULT_FOREST_LIGHTING.ambient }, 0, 0, 0)).toBe(0);
  });

  it('returns an empty mask for non-positive dimensions', () => {
    expect(
      renderDappleMask({ scale: 0.25, speed: 0.1, intensity: 0.5 }, { width: 0, height: 64, timeMs: 0, seed: 1 }),
    ).toHaveLength(0);
    expect(
      renderDappleMask({ scale: 0.25, speed: 0.1, intensity: 0.5 }, { width: -1, height: 64, timeMs: 0, seed: 1 }),
    ).toHaveLength(0);
  });

  it('keeps mask output bounded for very large dapple scales', () => {
    const mask = renderDappleMask(
      { scale: Number.MAX_VALUE, speed: 0.1, intensity: 0.5 },
      { width: 8, height: 8, timeMs: 0, seed: 1 },
    );
    expect(mask).toHaveLength(64);
    expect(mask.every((value) => value >= 0 && value <= 255)).toBe(true);
  });
});
