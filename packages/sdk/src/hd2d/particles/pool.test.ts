import { describe, expect, it } from 'vitest';

import { createParticlePool } from './pool.js';
import { PARTICLE_PRESETS } from './presets.js';
import { PARTICLE_LIMITS } from './schema.js';
import { createWindField } from './wind.js';

const FRAME = 1000 / 60;
const leaves = PARTICLE_PRESETS['forest-leaves']!;

function snapshot() {
  const pool = createParticlePool({ 'forest-leaves': leaves });
  pool.emit('forest-leaves', { at: [0, 0, 0] });
  for (let frame = 0; frame < 120; frame += 1) pool.step(FRAME);
  return {
    count: pool.views.count,
    first: [0, 1, 2].map((index) =>
      [pool.views.x[index]!, pool.views.y[index]!, pool.views.z[index]!].map((value) => Number(value.toFixed(3))),
    ),
  };
}

function softCount(pool: ReturnType<typeof createParticlePool>): number {
  return pool.views.family.subarray(0, pool.views.count).reduce((sum, value) => sum + value, 0);
}

describe('particle pool', () => {
  it('caps catch-up work to four fixed substeps', () => {
    const pool = createParticlePool(PARTICLE_PRESETS);
    expect(pool.step(1000)).toBe(4);
    expect(pool.step(FRAME / 2)).toBe(0);
  });

  it('never exceeds the visible or soft caps during a five second burst', () => {
    const wind = createWindField({ direction: [1, 0, 0], strength: 2, seed: 3 });
    const pool = createParticlePool(PARTICLE_PRESETS, wind);
    // Four leaf emitters ask for 360 pixel particles and four mote emitters for 240 soft ones.
    for (let index = 0; index < PARTICLE_LIMITS.emitters; index += 1) {
      pool.emit(index % 2 ? 'soft-motes' : 'forest-leaves', { at: [0, 0, 0], intensity: 100 });
    }
    let peak = 0;
    for (let frame = 0; frame < 300; frame += 1) {
      pool.step(FRAME);
      peak = Math.max(peak, pool.views.count);
      expect(pool.views.count).toBeLessThanOrEqual(PARTICLE_LIMITS.visible);
      expect(softCount(pool)).toBeLessThanOrEqual(PARTICLE_LIMITS.soft);
    }
    expect(peak).toBe(PARTICLE_LIMITS.visible);
  });

  it('keeps live particles packed at the front of the views', () => {
    const pool = createParticlePool({ 'forest-leaves': leaves });
    pool.emit('forest-leaves', { at: [0, 0, 0], intensity: 20 });
    for (let frame = 0; frame < 600; frame += 1) pool.step(FRAME);
    expect(pool.views.count).toBeGreaterThan(0);
    expect(pool.views.alpha.subarray(0, pool.views.count).every((value) => value > 0)).toBe(true);
  });

  it('halves the count on low quality and spawns nothing when off', () => {
    const pool = createParticlePool({
      low: { ...leaves, quality: 'low' },
      off: { ...leaves, quality: 'off' },
    });
    pool.emit('off', { at: [0, 0, 0], intensity: 100 });
    for (let frame = 0; frame < 60; frame += 1) pool.step(FRAME);
    expect(pool.views.count).toBe(0);
    pool.emit('low', { at: [0, 0, 0], intensity: 100 });
    for (let frame = 0; frame < 60; frame += 1) pool.step(FRAME);
    expect(pool.views.count).toBe(leaves.count / 2);
  });

  it('limits active emitters and frees a slot on dispose', () => {
    const pool = createParticlePool({ 'forest-leaves': leaves });
    const handles = Array.from({ length: PARTICLE_LIMITS.emitters }, () =>
      pool.emit('forest-leaves', { at: [0, 0, 0] }),
    );
    expect(() => pool.emit('forest-leaves', { at: [0, 0, 0] })).toThrow(RangeError);
    for (let frame = 0; frame < 60; frame += 1) pool.step(FRAME);
    for (const handle of handles) handle.dispose();
    expect(pool.views.count).toBe(0);
    expect(() => pool.emit('forest-leaves', { at: [0, 0, 0] })).not.toThrow();
  });

  it('ignores a stale handle after its slot is reused, and off emits need no slot', () => {
    const pool = createParticlePool({ 'forest-leaves': leaves, off: { ...leaves, quality: 'off' } });
    const stale = pool.emit('forest-leaves', { at: [0, 0, 0] });
    stale.dispose();
    pool.emit('forest-leaves', { at: [0, 0, 0], intensity: 10 });
    for (let index = 1; index < PARTICLE_LIMITS.emitters; index += 1) pool.emit('forest-leaves', { at: [0, 0, 0] });
    expect(() => pool.emit('off', { at: [0, 0, 0] })).not.toThrow();
    for (let frame = 0; frame < 30; frame += 1) pool.step(FRAME);
    const live = pool.views.count;
    stale.dispose();
    stale.stop();
    expect(pool.views.count).toBe(live);
  });

  it('is deterministic with wind', () => {
    const run = () => {
      const pool = createParticlePool(
        PARTICLE_PRESETS,
        createWindField({ direction: [1, 0, 0.3], strength: 1, seed: 9 }),
      );
      pool.emit('forest-leaves', { at: [0, 0, 0] });
      pool.emit('forest-leaves', { at: [0, 0, 0] });
      for (let frame = 0; frame < 120; frame += 1) pool.step(FRAME);
      return Array.from(pool.views.x.subarray(0, pool.views.count));
    };
    const first = run();
    expect(first.length).toBeGreaterThan(0);
    expect(run()).toEqual(first);
  });

  it('lets stopped emitters fade out without spawning more', () => {
    const pool = createParticlePool({ 'forest-leaves': leaves });
    const handle = pool.emit('forest-leaves', { at: [0, 0, 0], intensity: 10 });
    for (let frame = 0; frame < 30; frame += 1) pool.step(FRAME);
    handle.stop();
    const before = pool.views.count;
    pool.step(FRAME);
    expect(pool.views.count).toBeLessThanOrEqual(before);
    for (let frame = 0; frame < 60 * 8; frame += 1) pool.step(FRAME);
    expect(pool.views.count).toBe(0);
  });

  it('produces the deterministic forest snapshot', () => {
    const first = snapshot();
    expect(snapshot()).toEqual(first);
    expect(first).toMatchInlineSnapshot(`
      {
        "count": 15,
        "first": [
          [
            -5.599,
            -3.289,
            5.617,
          ],
          [
            3.078,
            -2.225,
            -4.444,
          ],
          [
            -2.017,
            1.16,
            -3.375,
          ],
        ],
      }
    `);
  });
});
