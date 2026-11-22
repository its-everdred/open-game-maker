import { DEFAULT_FOCUS, type FocusConfig } from '../../../../packages/sdk/src/hd2d/focus/index.js';
import type { LightingPreset } from '../../../../packages/sdk/src/hd2d/lighting/index.js';

/** Kevin's three liked looks from the #878 forest-lighting round (Moonlit camp was not picked). */
export const PRESET_IDS = ['golden', 'daylight', 'amber'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** Shafts fall from the top left, as in the mocks. */
const SUN = 1.1;
/** The sampler's biome, and the weathers that let sun shafts through its canopy. */
export const BIOME = 'forest';
export const SHAFT_WEATHER = ['clear', 'partly-cloudy'];
/**
 * Kevin (round 3): small shafts in the top half or less. Kevin (round 3 review): they come at random, in certain biomes
 * and weather, at random places, lengths and brightness, and need not touch the ground.
 */
const BEAMS = {
  direction: SUN,
  count: 5,
  reach: 0.45,
  width: 0.05,
  pool: 1,
  cycle: 8,
  chance: 0.8,
  when: { biomes: [BIOME], weather: SHAFT_WEATHER },
};
/** Kevin: drifting cloud cover that shades the ground, with sunny spots between. */
const CLOUDS = { coverage: 0.45, scale: 0.55, speed: 0.015, direction: 0.3 };

/** Short shafts, cloud shadows and a light canopy dapple; the campfire is added per scene at its anchor. */
export const PRESETS: Record<PresetId, LightingPreset> = {
  golden: {
    ambient: { color: '#ffe9b0', intensity: 1 },
    grade: { temperature: 0.3, saturation: 1.05, contrast: 1.04 },
    shafts: { ...BEAMS, color: '#ffd77a', intensity: 0.6 },
    clouds: { ...CLOUDS, shadow: 0.45, sun: 0.35 },
    dapple: { mask: 'canopy', scale: 0.3, speed: 0.08, intensity: 0.2 },
  },
  daylight: {
    ambient: { color: '#f4fbe6', intensity: 1 },
    grade: { temperature: 0.05, saturation: 1, contrast: 1.02 },
    shafts: { ...BEAMS, color: '#fff3c4', intensity: 0.45 },
    clouds: { ...CLOUDS, shadow: 0.35, sun: 0.3 },
    dapple: { mask: 'canopy', scale: 0.3, speed: 0.08, intensity: 0.15 },
  },
  amber: {
    ambient: { color: '#ffc982', intensity: 0.85 },
    grade: { temperature: 0.6, saturation: 1.1, contrast: 1.08 },
    shafts: { ...BEAMS, color: '#ffb04a', intensity: 0.65 },
    clouds: { ...CLOUDS, shadow: 0.5, sun: 0.4 },
    dapple: { mask: 'canopy', scale: 0.3, speed: 0.08, intensity: 0.2 },
  },
};

/** Kevin's blur pick: depth bands with the hero crisp. Haze is for 3D scenes only. */
export const FOCUS: FocusConfig = { ...DEFAULT_FOCUS };

/** Kevin keeps the blur on the low tier (round 2); low saves its cost by lighting fewer sprites instead. */
export function focusQuality(focus: boolean, quality: 'low' | 'high'): 'low' | 'high' | 'off' {
  return focus ? quality : 'off';
}
