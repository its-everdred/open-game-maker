import { DEFAULT_FOREST_LIGHTING, type LightingPreset } from '../lighting/index.js';

/** The forest preset with short beams and cloud shadows instead of the wide wash and dapple (`sky=1`). */
export const FIXTURE_SKY: LightingPreset = {
  ambient: DEFAULT_FOREST_LIGHTING.ambient,
  grade: DEFAULT_FOREST_LIGHTING.grade,
  shafts: { direction: 1.2, color: '#ffe7a1', intensity: 0.7, count: 4, reach: 0.5, width: 0.04, pool: 0.9 },
  clouds: { coverage: 0.45, scale: 0.45, speed: 0.02, shadow: 0.6, sun: 0.3 },
};
