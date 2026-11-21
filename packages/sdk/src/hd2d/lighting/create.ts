import type { Lighting, LightingOptions, LightingTarget } from './field.js';
import { createPhaserLighting } from './phaser.js';
import type { LightingPreset } from './schema.js';
import { createThreeLighting } from './three.js';

/** Lights a Phaser 4 or three.js scene from one renderer-neutral preset; the target's key picks the backend. */
export function createLighting(target: LightingTarget, preset: LightingPreset, options?: LightingOptions): Lighting {
  if ('phaser' in target) return createPhaserLighting(target.phaser, preset, options);
  if ('three' in target) return createThreeLighting(target.three, preset, options);
  throw new Error('createLighting needs a { phaser } or { three } target');
}
