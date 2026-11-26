import { describe, expect, it } from 'vitest';

import { MAX_PALETTE, parsePalette } from './finish.js';

describe('vfx palette', () => {
  it('reads #rgb and #rrggbb colours as 0-1 RGB for the finish shader', () => {
    expect(Array.from(parsePalette(['#ff8000', '#0F0']))).toEqual(
      Array.from(new Float32Array([1, 128 / 255, 0, 0, 1, 0])),
    );
    expect(parsePalette([])).toHaveLength(0);
  });

  it('refuses colours the shader cannot clamp to', () => {
    expect(() => parsePalette(['orange'])).toThrow(RangeError);
    expect(() => parsePalette(Array.from({ length: MAX_PALETTE + 1 }, () => '#000'))).toThrow(RangeError);
  });
});
