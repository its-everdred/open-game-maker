import { describe, expect, it } from 'vitest';

import { blurForDepth, DEFAULT_FOCUS } from '../focus/index.js';
import { DEFAULT_FOREST_LIGHTING, sampleShaftIntensity } from '../lighting/index.js';
import { createParticleDriver, moteLook, MOTE_SHADE, type ParticleBackend } from './create.js';
import { PARTICLE_PRESETS } from './presets.js';

const look = new Float64Array(2);

/** A backend that records what the driver draws; screen space is pool x/y over a 10-unit view, 10 px per unit. */
function recorder() {
  const drawn: { family: number; x: number; y: number; z: number; size: number; alpha: number; color: number }[] = [];
  const backend: ParticleBackend = {
    begin: () => (drawn.length = 0),
    screen(x, y, _z, out) {
      out[0] = x / 10;
      out[1] = y / 10;
      out[2] = 10;
    },
    draw: (family, _slot, x, y, z, _rot, size, alpha, color) => drawn.push({ family, x, y, z, size, alpha, color }),
    end() {},
    dispose() {},
  };
  return { backend, drawn };
}

describe('moteLook', () => {
  it("follows the lighting core's shaft intensity: dim outside shafts, full inside", () => {
    const options = { lighting: DEFAULT_FOREST_LIGHTING };
    const samples: { light: number; alpha: number }[] = [];
    for (let x = 0; x <= 1; x += 0.01) {
      moteLook(options, x, 0.2, 1000, 10, 1, look);
      samples.push({ light: sampleShaftIntensity(DEFAULT_FOREST_LIGHTING, x, 0.2, 1000), alpha: look[1]! });
    }
    // The sweep must cross both a shaft and the shadow between shafts, or it proves nothing.
    expect(Math.max(...samples.map((s) => s.light))).toBeGreaterThan(0.3);
    expect(Math.min(...samples.map((s) => s.light))).toBe(0);
    for (const { light, alpha } of samples) expect(alpha).toBeCloseTo(MOTE_SHADE + (1 - MOTE_SHADE) * light, 6);
  });

  it('grows and fades an out-of-focus mote by the focus core blur, and leaves the focal one alone', () => {
    const focus = { config: DEFAULT_FOCUS, depth: 0.7 };
    moteLook({ focus }, 0.5, 0.7, 0, 10, 1, look);
    expect([look[0], look[1]]).toEqual([10, 1]);

    const blur = blurForDepth(DEFAULT_FOCUS, 0.1, 0.7);
    expect(blur).toBeGreaterThan(0);
    moteLook({ focus }, 0.5, 0.1, 0, 10, 1, look);
    expect(look[0]).toBeCloseTo(10 + 2 * blur, 6);
    expect(look[1]).toBeLessThan(1);
  });

  it('keeps every mote sharp when focus quality is off', () => {
    moteLook({ focus: { config: { ...DEFAULT_FOCUS, quality: 'off' }, depth: 0.7 } }, 0.5, 0.1, 0, 10, 1, look);
    expect([look[0], look[1]]).toEqual([10, 1]);
  });
});

describe('createParticleDriver', () => {
  it('starts prewarmed, so an ambient effect is already in the air on the first frame', () => {
    const { backend, drawn } = recorder();
    const particles = createParticleDriver(backend);
    particles.emit('forest-leaves', { at: [5, 5, 0] });
    particles.update(0);
    expect(drawn.length).toBeGreaterThan(20);
    expect(particles.drawn).toBe(drawn.length);
  });

  it('keeps each leaf its palette colour while the core repacks its slots', () => {
    const { backend, drawn } = recorder();
    const particles = createParticleDriver(backend);
    particles.emit('forest-leaves', { at: [5, 5, 0] });
    const palette = PARTICLE_PRESETS['forest-leaves']!.palette!.map((hex) => Number.parseInt(hex.slice(1), 16));
    let previous: typeof drawn = [];
    let changed = 0;
    for (let ms = 0; ms <= 3000; ms += 1000 / 60) {
      particles.update(ms);
      for (const leaf of drawn) {
        expect(palette).toContain(leaf.color);
        // The same leaf one frame later sits within a frame's motion of where it was; skip leaves passing each other.
        const before = previous.filter(
          (p) => Math.abs(p.x - leaf.x) < 0.14 && Math.abs(p.y - leaf.y) < 0.14 && Math.abs(p.z - leaf.z) < 0.14,
        );
        if (before.length === 1 && before[0]!.color !== leaf.color) changed += 1;
      }
      previous = drawn.map((entry) => ({ ...entry }));
    }
    expect(changed).toBe(0);
  });

  it('draws at most half the particles at low quality that it draws at high', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const counts = (['high', 'low'] as const).map((quality) => {
        const { backend } = recorder();
        const particles = createParticleDriver(backend, { quality, seed });
        particles.emit('forest-leaves', { at: [5, 5, 0] });
        particles.emit('forest-motes', { at: [5, 5, 0] });
        particles.update(0);
        particles.update(2000);
        return particles.drawn;
      });
      expect(counts[1]).toBeGreaterThan(0);
      expect(counts[1]).toBeLessThanOrEqual(counts[0]! / 2);
    }
  });

  it('draws nothing at quality off, and restarts live emitters when the tier changes', () => {
    const { backend } = recorder();
    const particles = createParticleDriver(backend, { quality: 'off' });
    particles.emit('forest-leaves', { at: [5, 5, 0] });
    particles.update(0);
    expect(particles.drawn).toBe(0);
    particles.setQuality('high');
    particles.update(16);
    expect(particles.drawn).toBeGreaterThan(0);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const run = (seed: number) => {
      const { backend, drawn } = recorder();
      const particles = createParticleDriver(backend, { seed });
      particles.emit('forest-motes', { at: [5, 5, 0] });
      particles.update(0);
      particles.update(500);
      return drawn.map((entry) => [entry.x, entry.y, entry.alpha]);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});
