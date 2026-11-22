import { describe, expect, it } from 'vitest';

import { particleEffectSchema } from './schema.js';

const effect = {
  seed: 1,
  family: 'pixel',
  palette: ['#abc'],
  emitter: { shape: 'point' },
  count: 10,
  rate: 5,
  lifetime: [1, 2],
  velocity: { x: [-1, 1], y: [1, 2], z: [-1, 1] },
  gravity: [0, -1, 0],
  windResponse: 0.5,
  depthBand: [0, 1],
  quality: 'high',
} as const;

describe('particleEffectSchema', () => {
  it('rejects rates and counts above the safety caps', () => {
    expect(particleEffectSchema.safeParse({ ...effect, rate: 61 }).success).toBe(false);
    expect(particleEffectSchema.safeParse({ ...effect, count: 301 }).success).toBe(false);
  });

  it('rejects non-positive lifetimes and depth bands outside [0, 1]', () => {
    expect(particleEffectSchema.safeParse({ ...effect, lifetime: [0, 1] }).success).toBe(false);
    expect(particleEffectSchema.safeParse({ ...effect, depthBand: [0, 1.5] }).success).toBe(false);
  });

  it('caps soft particles at 80', () => {
    expect(particleEffectSchema.safeParse({ ...effect, family: 'soft', count: 81 }).success).toBe(false);
  });
});
