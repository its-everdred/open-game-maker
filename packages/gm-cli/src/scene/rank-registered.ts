import type { Image } from '../look/score.js';
import { scoreRegisteredScene } from './registered-score.js';
import type { SceneRegion } from './region-score.js';
import type { Raster } from './warp.js';

/** Rank covered registered regions by structural image mismatch, not by its cause. */
export function rankRegisteredRegions(reference: Image, render: Raster, regions: readonly SceneRegion[]) {
  return scoreRegisteredScene(reference, render, regions)
    .map((score) => ({ ...score, mismatch: 1 - score.ssim }))
    .sort((a, b) => b.mismatch - a.mismatch || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
