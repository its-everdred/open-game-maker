import { describe, expect, it } from 'vitest';

import { applyHaze, hazeMix } from './haze.js';

describe('HD-2D haze', () => {
  it('returns a deterministic distance table and applies the haze color', () => {
    const atmosphere = { haze: { color: '#ffffff', distance: 16, density: 0.8 } };
    const table = [0, 8, 16, 32, 64].map((distance) => hazeMix(atmosphere, distance));
    expect(table).toMatchInlineSnapshot(`
      [
        0,
        0.31477547222989327,
        0.5056964470628461,
        0.6917317734107099,
        0.7853474888890126,
      ]
    `);
    expect(applyHaze([0, 0, 0], atmosphere, 16)).toEqual([0.5056964470628461, 0.5056964470628461, 0.5056964470628461]);
  });

  it('accounts for optional height and no-haze scenes', () => {
    expect(hazeMix({ haze: { color: '#000000', distance: 10, height: 4 } }, 10, 0)).toBe(0);
    expect(hazeMix({ haze: { color: '#000000', distance: 10 } }, 10)).toBeCloseTo(1 - Math.exp(-1));
    expect(hazeMix({}, 100)).toBe(0);
  });
});
