import type { FocusConfig } from './schema.js';

/** Returns the depth-based blur radius in pixels for a normalized depth. */
export function blurForDepth(config: FocusConfig, depth: number, focusDepth: number): number {
  if (
    (config.mode !== 'depthBands' && config.mode !== 'depthOfField') ||
    config.quality === 'off' ||
    config.strength === 0
  )
    return 0;
  const distance = Math.max(0, Math.abs(depth - focusDepth) - config.range / 2);
  const qualityScale = config.quality === 'low' ? 0.5 : 1;
  return (distance / Math.max((1 - config.range) / 2, Number.EPSILON)) * config.strength * 12 * qualityScale;
}

/** Returns the normalized blur weight for a vertical screen coordinate. */
export function tiltShiftWeight(config: FocusConfig, screenY01: number): number {
  if (config.mode !== 'tiltShift' || config.quality === 'off' || config.strength === 0) return 0;
  const distance = Math.max(0, Math.abs(screenY01 - 0.5) - config.range / 2);
  const weight = Math.min(1, distance / Math.max(config.range / 2, Number.EPSILON));
  return weight * config.strength * (config.quality === 'low' ? 0.5 : 1);
}
