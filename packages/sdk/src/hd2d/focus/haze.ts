import type { SceneAtmosphere } from './schema.js';

export function hazeMix(atmosphere: SceneAtmosphere, distance: number, height?: number): number {
  const haze = atmosphere.haze;
  if (!haze || haze.density === 0) return 0;
  const distanceMix = haze.distance === undefined ? 0 : 1 - Math.exp(-Math.max(0, distance) / haze.distance);
  const heightMix =
    haze.height === undefined || height === undefined ? 1 : Math.max(0, Math.min(1, height / haze.height));
  return Math.max(0, Math.min(1, distanceMix * heightMix * (haze.density ?? 1)));
}

/** Mixes an RGB color toward the configured six-digit hex haze color. */
export function applyHaze(
  rgb: readonly [number, number, number],
  atmosphere: SceneAtmosphere,
  distance: number,
): [number, number, number] {
  const amount = hazeMix(atmosphere, distance);
  const color = atmosphere.haze?.color;
  if (!color || amount === 0) return [...rgb];
  const hazeRgb = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255);
  return rgb.map((channel, index) => channel * (1 - amount) + hazeRgb[index]! * amount) as [number, number, number];
}
