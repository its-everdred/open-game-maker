import { metrics, type Image, type Rect } from '../look/score.js';

export type SceneRegion = { id: string; bounds: Rect };

/** Fraction of adjacent pixel pairs with a visible luminance edge (a detail proxy, not object count). */
function edgeDensity(image: Image, { x, y, w, h }: Rect): number {
  let edges = 0;
  let pairs = 0;
  const luminance = (px: number, py: number) => {
    const i = (py * image.width + px) * 3;
    return 0.299 * image.pixels[i]! + 0.587 * image.pixels[i + 1]! + 0.114 * image.pixels[i + 2]!;
  };
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const here = luminance(px, py);
      if (px + 1 < x + w) {
        pairs++;
        if (Math.abs(here - luminance(px + 1, py)) > 24) edges++;
      }
      if (py + 1 < y + h) {
        pairs++;
        if (Math.abs(here - luminance(px, py + 1)) > 24) edges++;
      }
    }
  }
  return pairs ? edges / pairs : 0;
}

/** Compare corresponding regions after the caller has registered both images. */
export function scoreSceneRegions(reference: Image, render: Image, regions: readonly SceneRegion[]) {
  if (
    !Number.isSafeInteger(reference.width) ||
    !Number.isSafeInteger(reference.height) ||
    reference.width < 1 ||
    reference.height < 1 ||
    render.width !== reference.width ||
    render.height !== reference.height ||
    reference.pixels.length !== reference.width * reference.height * 3 ||
    render.pixels.length !== render.width * render.height * 3
  )
    throw new Error('registered images must have identical RGB dimensions');
  const ids = new Set<string>();
  return regions.map(({ id, bounds }) => {
    const { x, y, w, h } = bounds;
    if (!id || ids.has(id)) throw new Error('scene region ids must be unique and non-empty');
    ids.add(id);
    if (
      ![x, y, w, h].every(Number.isSafeInteger) ||
      x < 0 ||
      y < 0 ||
      w < 1 ||
      h < 1 ||
      x + w > reference.width ||
      y + h > reference.height
    )
      throw new Error(`invalid bounds for scene region ${id}`);
    return {
      id,
      bounds,
      ...metrics(reference, render, bounds),
      referenceEdgeDensity: edgeDensity(reference, bounds),
      renderEdgeDensity: edgeDensity(render, bounds),
    };
  });
}
