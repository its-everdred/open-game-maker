import { describe, expect, it } from 'vitest';

import { FOREST_DEFAULT_PRESETS, PARTICLE_PRESETS } from './presets.js';
import { particleEffectSchema } from './schema.js';

describe('HD-2D particle presets', () => {
  it('provides valid renderer-neutral data for each named preset', () => {
    for (const effect of Object.values(PARTICLE_PRESETS)) expect(particleEffectSchema.parse(effect)).toEqual(effect);
  });

  it('uses both leaves and motes for the forest default', () => {
    expect(FOREST_DEFAULT_PRESETS).toEqual(['forest-leaves', 'forest-motes']);
  });
});
