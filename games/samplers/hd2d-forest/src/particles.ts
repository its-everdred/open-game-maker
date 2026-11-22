import {
  createParticlePool,
  createWindField,
  FOREST_DEFAULT_PRESETS,
  PARTICLE_PRESETS,
  type ParticleHandle,
  type ParticlePool,
  type WindField,
  type WindSettings,
} from '../../../../packages/sdk/src/hd2d/particles/index.js';
import { sampleShaftIntensity, type LightingPreset } from '../../../../packages/sdk/src/hd2d/lighting/index.js';

/**
 * The clearing's particle data: Kevin's pick of both pixel leaves and soft motes, from the core particle presets. One
 * particle unit is one isometric cell: x and z run along the cell axes from the hero's cell, y is height. Drawing waits
 * on the core particle backends (#1178); this module only simulates.
 */

/** One breeze for the falling leaves and the canopy sway, blowing toward screen right. */
export const WIND: WindSettings = { direction: [0.7, 0, -0.7], strength: 0.6, seed: 5 };

const [LEAVES, MOTES] = FOREST_DEFAULT_PRESETS;
/** How often the motes follow the drifting shafts. */
export const MOTE_RETARGET_MS = 3000;
const FIRST_AIM_MS = 250;
/** Canopy rotation per unit of wind, in radians. */
const SWAY = 0.035;

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** World pixels of the pack projection to particle cells, relative to the hero's cell. */
export function worldToCell(x: number, y: number): [x: number, z: number] {
  return [(x / 64 + y / 32) / 2, (y / 32 - x / 64) / 2];
}

/** The ground cell under the brightest light shaft on screen right now, so the motes hang in the light. */
export function shaftCell(preset: LightingPreset, timeMs: number, view: ViewRect, steps = 24): [x: number, z: number] {
  let best = { value: -1, x: 0.5, y: 0.5 };
  for (let j = 1; j < steps; j += 1)
    for (let i = 1; i < steps; i += 1) {
      const x = i / steps;
      const y = j / steps;
      const value = sampleShaftIntensity(preset, x, y, timeMs);
      if (value > best.value) best = { value, x, y };
    }
  return worldToCell(view.x + best.x * view.width, view.y + best.y * view.height);
}

/** How far a tree at a cell leans in the wind: the wind's screen-right component (+x, -z cells), in radians. */
export function swayAt(wind: WindField, x: number, z: number, timeMs: number): number {
  const [wx, , wz] = wind.sample(x, 0, z, timeMs);
  return (wx - wz) * Math.SQRT1_2 * SWAY;
}

export interface ForestParticles {
  readonly wind: WindField;
  readonly pool: ParticlePool;
  /** Advances the simulation and keeps the motes in the shafts. */
  step(dtMs: number, timeMs: number, preset: LightingPreset, view: ViewRect): void;
}

export function createForestParticles(): ForestParticles {
  const wind = createWindField(WIND);
  const pool = createParticlePool(PARTICLE_PRESETS, wind);
  // Leaves fall across the whole clearing, from canopy height.
  pool.emit(LEAVES, { at: [0, 5, 0] });
  let motes: ParticleHandle | undefined;
  // The camera's view is only final after its first render, so the first aim waits a moment.
  let retargetAt = FIRST_AIM_MS;
  return {
    wind,
    pool,
    step(dtMs, timeMs, preset, view) {
      if (timeMs >= retargetAt) {
        retargetAt = timeMs + MOTE_RETARGET_MS;
        motes?.stop();
        const [x, z] = shaftCell(preset, timeMs, view);
        motes = pool.emit(MOTES, { at: [x, 1, z] });
      }
      pool.step(dtMs);
    },
  };
}
