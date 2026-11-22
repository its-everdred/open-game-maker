import { describe, expect, it } from 'vitest';

import { createWindField } from './wind.js';

describe('createWindField', () => {
  it('samples identical wind for the same seed, position and time', () => {
    const settings = { direction: [1, 0, 0] as const, strength: 0.5, seed: 17 };
    expect(createWindField(settings).sample(3, 4, 5, 600)).toEqual(createWindField(settings).sample(3, 4, 5, 600));
  });

  it('gusts over time and writes into a reused vector', () => {
    const wind = createWindField({ direction: [1, 0, 0], strength: 1, seed: 5 });
    const out: [number, number, number] = [0, 0, 0];
    expect(wind.sample(0, 0, 0, 0, out)).toBe(out);
    const start = out[0];
    expect(wind.sample(0, 0, 0, 4000)[0]).not.toBeCloseTo(start, 2);
  });

  it('updates settings without replacing the field', () => {
    const wind = createWindField({ direction: [1, 0, 0], strength: 0, seed: 1 });
    wind.set({ strength: 1 });
    expect(wind.sample(0, 0, 0, 0)).not.toEqual([0, 0, 0]);
    expect(() => wind.set({ strength: -1 })).toThrow(RangeError);
  });
});
