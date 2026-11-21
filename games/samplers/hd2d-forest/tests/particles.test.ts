import { describe, expect, it } from 'vitest';

import { sampleShaftIntensity } from '../../../../packages/sdk/src/hd2d/lighting/index.js';
import { cellPoint, HERO } from '../src/clearing.js';
import { createForestParticles, shaftCell, swayAt, worldToCell, type ViewRect } from '../src/particles.js';
import { PRESETS } from '../src/presets.js';

const view: ViewRect = { x: -500, y: -311, width: 1000, height: 562 };

describe('forest particles', () => {
  it('maps world pixels back to the cell the layout put them on', () => {
    const { x, y } = cellPoint([HERO[0] + 3, HERO[1] - 2]);
    const [cx, cz] = worldToCell(x, y);
    expect(cx).toBeCloseTo(3);
    expect(cz).toBeCloseTo(-2);
  });

  // Kevin's look puts the dust motes in the sun shafts, not spread over the shade.
  it('aims the motes at the brightest shaft on screen', () => {
    const preset = PRESETS.golden;
    for (const time of [0, 4000, 9000]) {
      const [cx, cz] = shaftCell(preset, time, view);
      const world = cellPoint([HERO[0] + cx, HERO[1] + cz]);
      const nx = (world.x - view.x) / view.width;
      const ny = (world.y - view.y) / view.height;
      expect(sampleShaftIntensity(preset, nx, ny, time)).toBeGreaterThan(preset.shafts!.intensity * 0.8);
    }
  });

  it('simulates both pixel leaves and soft motes (Kevin: both)', () => {
    const particles = createForestParticles();
    for (let t = 0; t < 6000; t += 50) particles.step(50, t, PRESETS.golden, view);
    const { family, count } = particles.pool.views;
    const kinds = new Set(Array.from(family.subarray(0, count)));
    expect(kinds).toEqual(new Set([0, 1]));
  });

  it('sways trees with the same wind the leaves ride, a few degrees at most', () => {
    const particles = createForestParticles();
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
