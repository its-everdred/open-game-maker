import { describe, expect, it } from 'vitest';

import { blurForDepth, tiltShiftWeight } from './bands.js';
import { DEFAULT_FOCUS, type FocusConfig } from './schema.js';

describe('HD-2D focus bands', () => {
  it('keeps the focal band crisp and increases blur toward either edge', () => {
    const config: FocusConfig = { ...DEFAULT_FOCUS, strength: 0.6, range: 0.25, quality: 'high' };
    const table = Array.from({ length: 11 }, (_, index) => blurForDepth(config, index / 10, 0.5));
    expect(blurForDepth(config, 0.5, 0.5)).toBe(0);
    expect(blurForDepth(config, 0.6, 0.5)).toBe(0);
    expect(table).toMatchInlineSnapshot(`
      [
        7.199999999999999,
        5.28,
        3.3599999999999994,
        1.4400000000000004,
        0,
        0,
        0,
        1.439999999999999,
        3.360000000000001,
        5.28,
        7.199999999999999,
      ]
    `);
    const at = (overrides: Partial<FocusConfig>) =>
      Array.from({ length: 11 }, (_, index) => blurForDepth({ ...config, ...overrides }, index / 10, 0.5));
    at({ quality: 'low' }).forEach((blur, index) => expect(blur).toBeCloseTo(table[index]! / 2));
    expect(at({ quality: 'off' }).every((blur) => blur === 0)).toBe(true);
    expect(at({ mode: 'depthOfField' })).toEqual(table);
    expect(at({ mode: 'tiltShift' }).every((blur) => blur === 0)).toBe(true);
  });

  it('weights the outer screen bands only in tilt shift mode', () => {
    const config = { ...DEFAULT_FOCUS, mode: 'tiltShift' as const, range: 0.4 };
    expect(tiltShiftWeight(config, 0.5)).toBe(0);
    expect(tiltShiftWeight(config, 0)).toBeGreaterThan(0);
    expect(tiltShiftWeight({ ...config, quality: 'off' }, 0)).toBe(0);
  });
});
