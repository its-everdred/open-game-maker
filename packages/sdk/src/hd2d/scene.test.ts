import { describe, expect, it } from 'vitest';

import { focusConfigSchema, sceneAtmosphereSchema } from './focus/schema.js';
import { LightingPresetSchema } from './lighting/schema.js';
import { particleEffectSchema } from './particles/schema.js';
import {
  emitterEffect,
  HD2D_FOREST_DEFAULTS,
  Hd2dSceneError,
  parseHd2dScene,
  serializeHd2dScene,
  type Hd2dSceneConfig,
} from './scene.js';

const edited: Hd2dSceneConfig = {
  ...HD2D_FOREST_DEFAULTS,
  lighting: {
    ...HD2D_FOREST_DEFAULTS.lighting,
    lights: [{ id: 'lantern', x: 470, y: 285, radius: 80, color: '#ffb35c', intensity: 0.9 }],
  },
  focus: { ...HD2D_FOREST_DEFAULTS.focus, hero: 'hero' },
  atmosphere: { haze: { color: '#9ba99a', distance: 60, density: 0.6 } },
  particles: {
    ...HD2D_FOREST_DEFAULTS.particles,
    emitters: [{ preset: 'fireflies', at: [1, 2, 0], area: [6, 2, 6], density: 1.5 }],
    focusDepth: 0.7,
  },
};

function issuesOf(value: unknown) {
  try {
    parseHd2dScene(value);
  } catch (error) {
    if (error instanceof Hd2dSceneError) return error.issues.map((issue) => issue.path);
    throw error;
  }
  return [];
}

describe('HD2D_FOREST_DEFAULTS', () => {
  it('is a scene document whose sections each validate against their core schema', () => {
    expect(parseHd2dScene(HD2D_FOREST_DEFAULTS)).toEqual(HD2D_FOREST_DEFAULTS);
    LightingPresetSchema.parse(HD2D_FOREST_DEFAULTS.lighting);
    focusConfigSchema.parse({ ...HD2D_FOREST_DEFAULTS.focus, quality: 'high' });
    sceneAtmosphereSchema.parse(HD2D_FOREST_DEFAULTS.atmosphere);
    expect(HD2D_FOREST_DEFAULTS.particles.emitters.map((emitter) => emitter.preset)).toEqual([
      'forest-leaves',
      'forest-motes',
    ]);
    for (const emitter of HD2D_FOREST_DEFAULTS.particles.emitters) particleEffectSchema.parse(emitterEffect(emitter));
  });
});

describe('scene document round trip', () => {
  it('serializes to JSON that parses back and serializes to the identical text', () => {
    for (const config of [HD2D_FOREST_DEFAULTS, edited]) {
      const json = serializeHd2dScene(config);
      expect(parseHd2dScene(json)).toEqual(config);
      expect(serializeHd2dScene(parseHd2dScene(json))).toBe(json);
    }
  });

  it('rejects an invalid field with its path', () => {
    const json = JSON.parse(serializeHd2dScene(edited)) as Hd2dSceneConfig;
    expect(issuesOf({ ...json, lighting: { ...json.lighting, ambient: { color: '#fff', intensity: 2 } } })).toEqual([
      'lighting.ambient.color',
      'lighting.ambient.intensity',
    ]);
    expect(issuesOf({ ...json, focus: { ...json.focus, strength: -1 } })).toEqual(['focus.strength']);
    expect(issuesOf({ ...json, focus: { ...json.focus, quality: 'high' } })).toEqual(['focus']);
    const emitters = [{ preset: 'rain', at: [0, 0, 0], density: 9 }];
    expect(issuesOf({ ...json, particles: { ...json.particles, emitters } })).toEqual([
      'particles.emitters.0.preset',
      'particles.emitters.0.density',
    ]);
    expect(issuesOf({ ...json, version: 2 })).toEqual(['version']);
    // Wind the particle core can integrate: unit direction components and a bounded strength, never an overflow.
    const wind = { direction: [1e308, 0, 0], strength: 1e308, seed: 1 };
    expect(issuesOf({ ...json, particles: { ...json.particles, wind } })).toEqual([
      'particles.wind.direction.0',
      'particles.wind.strength',
    ]);
    expect(issuesOf('{not json')).toEqual(['(root)']);
  });

  it('caps a scene at the particle core emitter limit', () => {
    const emitters = Array.from({ length: 9 }, () => ({ preset: 'fireflies', at: [0, 0, 0] }));
    expect(issuesOf({ ...edited, particles: { ...edited.particles, emitters } })).toEqual(['particles.emitters']);
  });

  it('turns an emitter area into a box emitter of that size', () => {
    expect(emitterEffect(edited.particles.emitters[0]!).emitter).toEqual({ shape: 'box', size: [6, 2, 6] });
  });
});
