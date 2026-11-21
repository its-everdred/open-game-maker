/** Coordinates on the ground plane, or pixels in the reference image. */
export type Point = { x: number; y: number };
export type Correspondence = { ground: Point; image: Point };
export type Homography = readonly [number, number, number, number, number, number, number, number];

/** Fit a ground-to-image projective transform from four known ground-plane anchors. */
export function fitGroundPlane(anchors: readonly Correspondence[]): Homography {
  if (
    anchors.length !== 4 ||
    anchors.some(({ ground, image }) => ![ground.x, ground.y, image.x, image.y].every(Number.isFinite))
  ) {
    throw new Error('ground registration requires four finite anchor pairs');
  }
  const matrix: number[][] = [];
  for (const {
    ground: { x, y },
    image: { x: u, y: v },
  } of anchors) {
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Partial pivoting both rejects ambiguous anchors and avoids dividing by a tiny pivot.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(matrix[row]![col]!) > Math.abs(matrix[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(matrix[pivot]![col]!) < 1e-10) throw new Error('ground anchors are degenerate');
    [matrix[col], matrix[pivot]] = [matrix[pivot]!, matrix[col]!];
    const selected = matrix[col]!;
    const divisor = selected[col]!;
    for (let j = col; j <= 8; j++) selected[j] = selected[j]! / divisor;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const target = matrix[row]!;
      const factor = target[col]!;
      for (let j = col; j <= 8; j++) target[j] = target[j]! - factor * selected[j]!;
    }
  }
  return matrix.map((row) => row[8]!) as unknown as Homography;
}

/** Project a ground-plane point; reject points on the transform's horizon. */
export function projectGround(transform: Homography, point: Point): Point {
  const [a, b, c, d, e, f, g, h] = transform;
  const denominator = g * point.x + h * point.y + 1;
  if (![...transform, point.x, point.y, denominator].every(Number.isFinite) || Math.abs(denominator) < 1e-10) {
    throw new Error('ground point lies on the registration horizon');
  }
  return { x: (a * point.x + b * point.y + c) / denominator, y: (d * point.x + e * point.y + f) / denominator };
}

/** Recover a ground position from a pixel known to lie on the same plane. */
export function fitImageToGround(anchors: readonly Correspondence[]): Homography {
  return fitGroundPlane(anchors.map(({ ground, image }) => ({ ground: image, image: ground })));
}
