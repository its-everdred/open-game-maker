import { describe, expect, it } from 'vitest';
import { flickerAt } from './flicker.js';

describe('flickerAt', () => {
  it('is deterministic for a seed and time and varies across seeds', () => {
    const a = { amount: 0.4, rate: 12, seed: 20 };
    expect(flickerAt(a, 1250)).toBe(flickerAt(a, 1250));
    expect(flickerAt(a, 1250)).not.toBe(flickerAt({ ...a, seed: 21 }, 1250));
  });

  it('returns a bounded multiplier', () => {
    expect(flickerAt({ amount: 0.3, rate: 8, seed: 1 }, 930)).toBeGreaterThanOrEqual(0.7);
    expect(flickerAt({ amount: 0.3, rate: 8, seed: 1 }, 930)).toBeLessThanOrEqual(1);
  });
});
