import type { Image } from '../look/score.js';
import { scoreSceneRegions, type SceneRegion } from './region-score.js';
import type { Raster } from './warp.js';

/** Score a warped render only where every requested pixel has source coverage. */
export function scoreRegisteredScene(reference: Image, render: Raster, regions: readonly SceneRegion[]) {
  if (
    !Number.isSafeInteger(render.width) ||
    !Number.isSafeInteger(render.height) ||
    render.width < 1 ||
    render.height < 1 ||
    render.width * render.height > 100_000_000 ||
    reference.width !== render.width ||
    reference.height !== render.height ||
    render.pixels.length !== render.width * render.height * 4
  )
    throw new Error('registered render dimensions do not match the reference');
  const pixels = Buffer.alloc(render.width * render.height * 3);
  for (let index = 0; index < render.width * render.height; index++) {
    const from = index * 4;
    const to = index * 3;
    pixels[to] = render.pixels[from]!;
    pixels[to + 1] = render.pixels[from + 1]!;
    pixels[to + 2] = render.pixels[from + 2]!;
  }
  // Validate bounds before accessing pixels; zero-alpha warp padding must not
  // be counted as black scene content in a quality score.
  const scores = scoreSceneRegions(reference, { width: render.width, height: render.height, pixels }, regions);
  for (const { id, bounds } of regions) {
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
        if (render.pixels[(y * render.width + x) * 4 + 3] !== 255)
          throw new Error(`scene region ${id} has incomplete registered coverage`);
      }
    }
  }
  return scores;
}
