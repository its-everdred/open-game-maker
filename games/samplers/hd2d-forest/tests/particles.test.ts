import { describe, expect, it } from 'vitest';

import { beamsAt } from '../../../../packages/sdk/src/hd2d/lighting/index.js';
import { createParticleDriver, type ParticleBackend } from '../../../../packages/sdk/src/hd2d/particles/create.js';
import { cellPoint, FIRE, HERO } from '../src/clearing.js';
import {
  createForestParticles,
  particleOptions,
  shaftPoint,
  swayAt,
  worldToCell,
  type ViewRect,
} from '../src/particles.js';
import { PRESETS } from '../src/presets.js';

const view: ViewRect = { x: -500, y: -311, width: 1000, height: 562 };

/** A backend that records draws; pool units map onto the test view like the Phaser backend at 64 px per unit. */
function recorder() {
  const drawn: { family: number }[] = [];
  const emitted: string[] = [];
  const backend: ParticleBackend = {
    begin: () => (drawn.length = 0),
    screen(x, y, _z, out) {
      out[0] = (x * 64 - view.x) / view.width;
      out[1] = (-y * 64 - view.y) / view.height;
      out[2] = 64;
    },
    draw: (family) => drawn.push({ family }),
    end() {},
    dispose() {},
  };
  return { backend, drawn, emitted };
}

describe('forest particles', () => {
  it('maps world pixels back to the cell the layout put them on', () => {
    const { x, y } = cellPoint([HERO[0] + 3, HERO[1] - 2]);
    const [cx, cz] = worldToCell(x, y);
    expect(cx).toBeCloseTo(3);
    expect(cz).toBeCloseTo(-2);
  });

  // Kevin's look puts the dust motes in the sun shafts, and the shafts stay in the top half of the screen.
  it('aims the motes at the brightest shaft showing, in the upper half, and nowhere when none shows', () => {
    const preset = PRESETS.golden;
    const aspect = view.width / view.height;
    let aimed = 0;
    for (let time = 0; time < 40_000; time += 1000) {
      const point = shaftPoint(preset, time, view);
      const shown = beamsAt(preset.shafts!, time, aspect);
      if (!point) {
        expect(shown).toEqual([]);
        continue;
      }
      aimed += 1;
      const nx = (point.x - view.x) / view.width;
      const ny = (point.y - view.y) / view.height;
      const best = Math.max(...shown.map((beam) => beam.brightness * beam.fade));
      const target = shown.find((beam) => Math.abs(beam.x - nx) < 1e-9 && Math.abs(beam.y - ny) < 1e-9)!;
      expect(target.brightness * target.fade).toBe(best);
      expect(ny).toBeLessThan(0.55);
    }
    expect(aimed).toBeGreaterThan(20);
    expect(shaftPoint({ ambient: preset.ambient }, 0, view)).toBeUndefined();
  });

  it('draws pixel leaves, soft motes and campfire embers (Kevin: both, plus the fire)', () => {
    const { backend, drawn, emitted } = recorder();
    const particles = createParticleDriver(backend, particleOptions('high', PRESETS.golden, undefined));
    const emit = particles.emit.bind(particles);
    particles.emit = (name, options) => (emitted.push(name), emit(name, options));
    const forest = createForestParticles(particles, cellPoint(FIRE));
    for (let t = 0; t < 6000; t += 50) forest.update(t, PRESETS.golden, view);
    expect(new Set(drawn.map((particle) => particle.family))).toEqual(new Set([0, 1]));
    expect(emitted).toEqual(expect.arrayContaining(['forest-leaves', 'forest-motes', 'campfire-embers']));
  });

  it('sways trees with the same wind the leaves ride, a few degrees at most', () => {
    const particles = createForestParticles(createParticleDriver(recorder().backend), cellPoint(FIRE));
    const leans = [0, 2000, 4000, 6000, 8000].map((t) => swayAt(particles.wind, 4, -3, t));
    expect(new Set(leans).size).toBeGreaterThan(1);
    for (const lean of leans) expect(Math.abs(lean)).toBeLessThan(0.08);
    // A breeze toward screen right (cell +x, -z per cellPoint) must lean the canopy right (positive rotation).
    particles.wind.set({ direction: [1, 0, -1], strength: 1 });
    expect(swayAt(particles.wind, 4, -3, 2000)).toBeGreaterThan(0);
    particles.wind.set({ direction: [-1, 0, 1] });
    expect(swayAt(particles.wind, 4, -3, 2000)).toBeLessThan(0);
  });
});
