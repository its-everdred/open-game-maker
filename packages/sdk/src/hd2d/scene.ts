import { z } from 'zod';

import { DEFAULT_FOCUS, focusConfigSchema, sceneAtmosphereSchema } from './focus/schema.js';
import { DEFAULT_FOREST_LIGHTING, LightingPresetSchema } from './lighting/schema.js';
import { DEFAULT_WIND } from './particles/create.js';
import { FOREST_DEFAULT_PRESETS, PARTICLE_PRESETS } from './particles/presets.js';
import { PARTICLE_LIMITS, type ParticleEffect } from './particles/schema.js';

export const HD2D_SCENE_VERSION = 1;

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const presetNames = Object.keys(PARTICLE_PRESETS) as [string, ...string[]];

const emitterSchema = z.strictObject({
  preset: z.enum(presetNames),
  /** Where it emits, in the particle target's units (y up). */
  at: vec3,
  /** Replaces the preset's emitter with a box of this size. */
  area: z.tuple([finite.min(0), finite.min(0), finite.min(0)]).optional(),
  /** Multiplies the preset's emission rate. */
  density: finite.min(0).max(4).optional(),
});

/**
 * One HD-2D scene as a versioned JSON document: what a game stores in its scene data and the editor edits. Its
 * sections match the scene doc's `hd2d` sections; the field limits are the core lighting, focus and particle
 * schemas'. Quality is not here: it belongs to the device, not the scene.
 */
export const hd2dSceneSchema = z.strictObject({
  version: z.literal(HD2D_SCENE_VERSION),
  /** The lighting preset with its overrides applied; its lights are in the target's scene coordinates. */
  lighting: LightingPresetSchema,
  /** Focus bands; `hero` names the scene object `target: 'player'` follows and keeps crisp. */
  focus: focusConfigSchema.omit({ quality: true }).extend({ hero: z.string().min(1).optional() }),
  /** Haze and pixel-art sampling. */
  atmosphere: sceneAtmosphereSchema,
  particles: z.strictObject({
    emitters: z.array(emitterSchema).max(PARTICLE_LIMITS.emitters),
    wind: z.strictObject({ direction: vec3, strength: finite.min(0), seed: z.number().int().safe() }),
    /** The depth (0 far .. 1 near) soft motes stay sharp at; they blur away from it like the scene's layers. */
    focusDepth: finite.min(0).max(1).optional(),
  }),
});

export type Hd2dSceneConfig = z.infer<typeof hd2dSceneSchema>;
export type Hd2dEmitter = Hd2dSceneConfig['particles']['emitters'][number];

/** The forest look: the lighting, focus and particle cores' forest defaults as one scene document. */
export const HD2D_FOREST_DEFAULTS: Hd2dSceneConfig = {
  version: HD2D_SCENE_VERSION,
  lighting: DEFAULT_FOREST_LIGHTING,
  focus: {
    mode: DEFAULT_FOCUS.mode,
    target: DEFAULT_FOCUS.target,
    smoothing: DEFAULT_FOCUS.smoothing,
    strength: DEFAULT_FOCUS.strength,
    range: DEFAULT_FOCUS.range,
  },
  atmosphere: {},
  particles: {
    emitters: FOREST_DEFAULT_PRESETS.map((preset) => ({ preset, at: [0, 0, 0] })),
    wind: { direction: [...DEFAULT_WIND.direction], strength: DEFAULT_WIND.strength, seed: DEFAULT_WIND.seed },
  },
};

export class Hd2dSceneError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(`invalid HD-2D scene: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'Hd2dSceneError';
  }
}

/** Validates a scene document (JSON text or an already parsed value); invalid fields throw with their path. */
export function parseHd2dScene(json: unknown): Hd2dSceneConfig {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch (error) {
      throw new Hd2dSceneError([{ path: '(root)', message: (error as Error).message }]);
    }
  }
  const result = hd2dSceneSchema.safeParse(value);
  if (!result.success)
    throw new Hd2dSceneError(
      result.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })),
    );
  return result.data;
}

/** The scene document as canonical JSON: parsing it back and serializing again gives the same text. */
export function serializeHd2dScene(config: Hd2dSceneConfig): string {
  return JSON.stringify(parseHd2dScene(config));
}

/** The particle effect one emitter runs: its preset, with the area as a box emitter when it sets one. */
export function emitterEffect(emitter: Hd2dEmitter): ParticleEffect {
  const preset = PARTICLE_PRESETS[emitter.preset]!;
  return emitter.area ? { ...preset, emitter: { shape: 'box', size: [...emitter.area] } } : preset;
}
