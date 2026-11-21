export { blurForDepth, tiltShiftWeight } from './bands.js';
export { applyHaze, hazeMix } from './haze.js';
export { createFocusFollower, type FocusPoint } from './follow.js';
export {
  DEFAULT_FOCUS,
  focusConfigSchema,
  occlusionStyleSchema,
  sceneAtmosphereSchema,
  type FocusConfig,
  type OcclusionStyle,
  type SceneAtmosphere,
} from './schema.js';
