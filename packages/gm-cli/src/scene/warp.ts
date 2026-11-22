import { isHorizon, projectGround, type Homography, type Point } from './registration.js';

export type Raster = { width: number; height: number; pixels: Uint8Array };

/**
 * Sample an RGBA source onto a destination plane using a destination-to-source transform. Destination pixels
 * beyond the transform's horizon (the side opposite the anchors) project to mirrored content, so stay transparent.
 */
export function warpNearest(
  source: Raster,
  width: number,
  height: number,
  destinationToSource: Homography,
  anchors: readonly Point[],
): Raster {
  if (
    ![source.width, source.height, width, height].every((n) => Number.isSafeInteger(n) && n > 0) ||
    source.width * source.height > 100_000_000 ||
    width * height > 100_000_000 ||
    source.pixels.length !== source.width * source.height * 4
  ) {
    throw new Error('invalid raster dimensions');
  }
  if (!destinationToSource.every(Number.isFinite)) throw new Error('invalid warp transform');
  const scale = Math.max(...destinationToSource.map(Math.abs));
  if (scale === 0) throw new Error('invalid warp transform');
  const [a, b, c, d, e, f, g, h, i] = destinationToSource.map((value) => value / scale);
  const determinant = a! * (e! * i! - f! * h!) - b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!);
  if (determinant === 0) throw new Error('invalid warp transform');
  const denominatorAt = ({ x, y }: Point) =>
    destinationToSource[6] * x + destinationToSource[7] * y + destinationToSource[8];
  const sides = new Set(anchors.map((point) => Math.sign(denominatorAt(point))));
  if (!anchors.length || sides.size !== 1 || sides.has(0) || sides.has(NaN))
    throw new Error('warp anchors must lie on one side of the registration horizon');
  const [side] = sides;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const denominator = denominatorAt({ x, y });
      if (Math.sign(denominator) !== side || isHorizon(destinationToSource, { x, y }, denominator)) continue;
      const sourcePoint = projectGround(destinationToSource, { x, y });
      const sx = Math.round(sourcePoint.x),
        sy = Math.round(sourcePoint.y);
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      const from = (sy * source.width + sx) * 4,
        to = (y * width + x) * 4;
      pixels.set(source.pixels.subarray(from, from + 4), to);
    }
  }
  return { width, height, pixels };
}
