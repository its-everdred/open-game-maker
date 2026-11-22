import { describe, expect, it } from 'vitest';
import { DEFAULT_FOREST_LIGHTING, LightingPresetSchema, LightingQualitySchema, maxLightsFor } from './schema.js';

describe('lighting preset', () => {
  it('accepts the spike-shaped forest preset', () => {
    expect(LightingPresetSchema.safeParse(DEFAULT_FOREST_LIGHTING).success).toBe(true);
  });

  it('rejects negative light radius and unknown quality', () => {
    const invalidPreset = {
      ...DEFAULT_FOREST_LIGHTING,
      lights: [{ id: 'lantern', x: 2, y: 3, radius: -1, color: '#ffcc88', intensity: 0.8 }],
    };
    expect(LightingPresetSchema.safeParse(invalidPreset).success).toBe(false);
    expect(LightingQualitySchema.safeParse('medium').success).toBe(false);
  });

  it('rejects values outside the preset ranges', () => {
    expect(
      LightingPresetSchema.safeParse({
        ...DEFAULT_FOREST_LIGHTING,
        ambient: { color: '#ffffff', intensity: 1.1 },
      }).success,
    ).toBe(false);
  });

  it('caps light counts by quality', () => {
    expect(maxLightsFor('off')).toBe(0);
    expect(maxLightsFor('low')).toBe(4);
    expect(maxLightsFor('high')).toBe(8);
  });
});
