import { describe, expect, it } from 'vitest';

import { DEFAULT_FOCUS, focusConfigSchema, occlusionStyleSchema, sceneAtmosphereSchema } from './schema.js';

describe('HD-2D focus schemas', () => {
  it('accepts the recommended depth band defaults and focus example', () => {
    expect(focusConfigSchema.parse(DEFAULT_FOCUS)).toEqual(DEFAULT_FOCUS);
    expect(focusConfigSchema.parse({ ...DEFAULT_FOCUS, strength: 0.6, range: 0.25, quality: 'high' })).toMatchObject({
      mode: 'depthBands',
      strength: 0.6,
      range: 0.25,
      quality: 'high',
    });
  });

  it('bounds effect controls and validates atmosphere and occlusion contracts', () => {
    expect(() => focusConfigSchema.parse({ ...DEFAULT_FOCUS, strength: 1.1 })).toThrow();
    expect(
      sceneAtmosphereSchema.parse({
        haze: { color: '#9ba99a', distance: 32 },
        pixelArt: { filter: 'nearest', sharp: true },
      }),
    ).toBeDefined();
    expect(occlusionStyleSchema.parse({ response: 'fade', opacity: 0.35 })).toEqual({
      response: 'fade',
      opacity: 0.35,
    });
  });
});
