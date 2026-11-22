import {
  createWindField,
  FOREST_DEFAULT_PRESETS,
  type ParticleHandle,
  type Particles,
  type ParticlesOptions,
  type WindField,
  type WindSettings,
} from '../../../../packages/sdk/src/hd2d/particles/index.js';
import { beamsAt, type LightingPreset } from '../../../../packages/sdk/src/hd2d/lighting/index.js';

/**
 * The clearing's particles: Kevin's pick of both pixel leaves and soft motes, plus campfire embers, all from the core
 * particle presets and drawn by its backends. Pool units are screen axes (y up), `SCALE` world pixels each, as the
 * core's Phaser backend expects.
 */

/** World pixels per pool unit: the presets' 12-unit boxes span the clearing. */
export const SCALE = 64;

/** One breeze for the canopy sway, in cell axes (x, height, z): toward screen right. */
export const WIND: WindSettings = { direction: [0.7, 0, -0.7], strength: 0.6, seed: 5 };
/** The same breeze for the particles, in their screen axes. */
export const PARTICLE_WIND: WindSettings = { direction: [1, 0, 0], strength: 0.6, seed: 5 };

const [LEAVES, MOTES] = FOREST_DEFAULT_PRESETS;
const EMBERS = 'campfire-embers';
/** How often the motes check that they still hang in the brightest shaft. */
export const MOTE_RETARGET_MS = 3000;
/** The motes move only when the brightest shaft has moved further than this (pool units). */
const RETARGET_DISTANCE = 1.5;
const FIRST_AIM_MS = 250;
/** Leaves start this far above the hero, at canopy height. */
const CANOPY = 250;
/** Canopy rotation per unit of wind, in radians. */
const SWAY = 0.035;

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** World pixels (y down) to pool units (y up); the core's Phaser backend flips y back. */
export function toPool(x: number, y: number): [number, number, number] {
  return [x / SCALE, -y / SCALE, 0];
}

/** World pixels of the pack projection to particle cells, relative to the hero's cell. */
export function worldToCell(x: number, y: number): [x: number, z: number] {
  return [(x / 64 + y / 32) / 2, (y / 32 - x / 64) / 2];
}

/**
 * The world point where the brightest shaft showing right now ends (its ground patch, or where it fades in the air), so
 * the motes hang in the light; undefined while no shaft shows (wrong weather, or between beams).
 */
export function shaftPoint(
  preset: LightingPreset,
  timeMs: number,
  view: ViewRect,
): { x: number; y: number } | undefined {
  if (!preset.shafts?.count) return undefined;
  const shown = beamsAt(preset.shafts, timeMs, view.width / view.height);
  if (!shown.length) return undefined;
  const best = shown.reduce((a, b) => (b.brightness * b.fade > a.brightness * a.fade ? b : a));
  return { x: view.x + best.x * view.width, y: view.y + best.y * view.height };
}

/** How far a tree at a cell leans in the wind: the wind's screen-right component (+x, -z cells), in radians. */
export function swayAt(wind: WindField, x: number, z: number, timeMs: number): number {
  const [wx, , wz] = wind.sample(x, 0, z, timeMs);
  return (wx - wz) * Math.SQRT1_2 * SWAY;
}

/** Driver options for the clearing; `lighting` is read live, so `setPreset` swaps it in place. */
export function particleOptions(
  quality: 'off' | 'low' | 'high',
  lighting: LightingPreset,
  focus: ParticlesOptions['focus'],
): ParticlesOptions {
  return { wind: PARTICLE_WIND, quality, seed: 7, lighting, focus };
}

export interface ForestParticles {
  /** The canopy's wind, in cell axes. */
  readonly wind: WindField;
  readonly particles: Particles;
  /** Draws the particles and keeps the motes in the brightest shaft. */
  update(timeMs: number, preset: LightingPreset, view: ViewRect): void;
}

/** Starts the leaves over the clearing and the embers on the fire; the motes follow the light. */
export function createForestParticles(particles: Particles, fire: { x: number; y: number }): ForestParticles {
  const wind = createWindField(WIND);
  particles.emit(LEAVES, { at: toPool(0, -CANOPY) });
  particles.emit(EMBERS, { at: toPool(fire.x, fire.y - 8) });
  let motes: { handle: ParticleHandle; at: [number, number, number] } | undefined;
  // The camera's view is only final after its first render, so the first aim waits a moment.
  let retargetAt = FIRST_AIM_MS;
  return {
    wind,
    particles,
    update(timeMs, preset, view) {
      if (timeMs >= retargetAt) {
        retargetAt = timeMs + MOTE_RETARGET_MS;
        const point = shaftPoint(preset, timeMs, view);
        const at = point && toPool(point.x, point.y);
        if (at && (!motes || Math.hypot(at[0] - motes.at[0], at[1] - motes.at[1]) > RETARGET_DISTANCE)) {
          motes?.handle.stop();
          motes = { handle: particles.emit(MOTES, { at }), at };
        }
      }
      particles.update(timeMs);
    },
  };
}
