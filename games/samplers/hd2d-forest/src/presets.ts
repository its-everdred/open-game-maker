import { DEFAULT_FOCUS, type FocusConfig } from '../../../../packages/sdk/src/hd2d/focus/index.js';
import type { LightingPreset } from '../../../../packages/sdk/src/hd2d/lighting/index.js';

/** Kevin's three liked looks from the #878 forest-lighting round (Moonlit camp was not picked). */
export const PRESET_IDS = ['golden', 'daylight', 'amber'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** Shafts fall from the top left, as in the mocks. */
const SUN = 1.1;

/** Soft shafts + dapple (Kevin's canopy pick); the campfire is added per scene at its anchor. */
export const PRESETS: Record<PresetId, LightingPreset> = {
  golden: {
    ambient: { color: '#ffe9b0', intensity: 1 },
    grade: { temperature: 0.3, saturation: 1.05, contrast: 1.04 },
    shafts: { direction: SUN, color: '#ffd77a', intensity: 0.55 },
    dapple: { mask: 'canopy', scale: 0.3, speed: 0.08, intensity: 0.35 },
  },
  daylight: {
    ambient: { color: '#f4fbe6', intensity: 1 },
    grade: { temperature: 0.05, saturation: 1, contrast: 1.02 },
    shafts: { direction: SUN, color: '#fff3c4', intensity: 0.35 },
    dapple: { mask: 'canopy', scale: 0.3, speed: 0.08, intensity: 0.25 },
  },
  amber: {
    ambient: { color: '#ffc982', intensity: 0.85 },
    grade: { temperature: 0.6, saturation: 1.1, contrast: 1.08 },
    shafts: { direction: SUN, color: '#ffb04a', intensity: 0.6 },
    dapple: { mask: 'canopy', scale: 0.3, speed: 0.08, intensity: 0.4 },
  },
};

/** Kevin's blur pick: depth bands with the hero crisp. Haze is for 3D scenes only. */
export const FOCUS: FocusConfig = { ...DEFAULT_FOCUS };

/** Kevin keeps the blur on the low tier (round 2); low saves its cost by lighting fewer sprites instead. */
export function focusQuality(focus: boolean, quality: 'low' | 'high'): 'low' | 'high' | 'off' {
  return focus ? quality : 'off';
}
