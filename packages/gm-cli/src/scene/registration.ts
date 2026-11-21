/** Coordinates on the ground plane, or pixels in the reference image. */
export type Point = { x: number; y: number };
export type Correspondence = { ground: Point; image: Point };
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/** Fit a ground-to-image projective transform from four known ground-plane anchors. */
export function fitGroundPlane(anchors: readonly Correspondence[]): Homography {
  if (
    anchors.length !== 4 ||
    anchors.some(({ ground, image }) => ![ground.x, ground.y, image.x, image.y].every(Number.isFinite))
  )
    throw new Error('ground registration requires four finite anchor pairs');
  const equations: number[][] = [];
  for (const {
    ground: { x, y },
    image: { x: u, y: v },
  } of anchors) {
    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y, -u]);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y, -v]);
  }
  if (equations.some((row) => row.some((value) => !Number.isFinite(value)))) {
    throw new Error('ground anchors exceed numeric range');
  }
  // A homography is defined only up to scale. Try each coefficient as the
  // fixed scale: valid transforms need not have a nonzero bottom-right entry.
  for (const gauge of [8, 0, 1, 2, 3, 4, 5, 6, 7]) {
    const columns = Array.from({ length: 9 }, (_, i) => i).filter((i) => i !== gauge);
    const matrix = equations.map((row) => [...columns.map((column) => row[column]!), -row[gauge]!]);
    let singular = false;
    for (let col = 0; col < 8; col++) {
      let pivot = col;
      for (let row = col + 1; row < 8; row++) {
        if (Math.abs(matrix[row]![col]!) > Math.abs(matrix[pivot]![col]!)) pivot = row;
      }
      if (Math.abs(matrix[pivot]![col]!) < 1e-10) {
        singular = true;
        break;
      }
      [matrix[col], matrix[pivot]] = [matrix[pivot]!, matrix[col]!];
      const selected = matrix[col]!,
        divisor = selected[col]!;
      for (let j = col; j <= 8; j++) selected[j] = selected[j]! / divisor;
      for (let row = 0; row < 8; row++) {
        if (row === col) continue;
        const target = matrix[row]!,
          factor = target[col]!;
        for (let j = col; j <= 8; j++) target[j] = target[j]! - factor * selected[j]!;
      }
    }
    if (singular) continue;
    const values = Array<number>(9).fill(0);
    values[gauge] = 1;
    columns.forEach((column, i) => {
      values[column] = matrix[i]![8]!;
    });
    if (!values.every(Number.isFinite)) continue;
    const transform = values as unknown as Homography;
    try {
      if (
        anchors.every(({ ground, image }) => {
          const point = projectGround(transform, ground);
          return (
            Math.hypot(point.x - image.x, point.y - image.y) <= 1e-7 * Math.max(1, Math.abs(image.x), Math.abs(image.y))
          );
        })
      )
        return transform;
    } catch {
      /* This gauge puts an anchor on the horizon. */
    }
  }
  throw new Error('ground anchors are degenerate');
}

/** Whether a finite denominator is effectively zero at this scale. */
export function isHorizon(transform: Homography, point: Point, denominator: number): boolean {
  const scale = Math.abs(transform[6] * point.x) + Math.abs(transform[7] * point.y) + Math.abs(transform[8]);
  return Number.isFinite(scale) && Math.abs(denominator) <= 1e-10 * scale;
}

/** Project a ground-plane point; reject points on the transform's horizon. */
export function projectGround(transform: Homography, point: Point): Point {
  const [a, b, c, d, e, f, g, h, i] = transform;
  const denominator = g * point.x + h * point.y + i;
  if (
    ![...transform, point.x, point.y, denominator].every(Number.isFinite) ||
    isHorizon(transform, point, denominator)
  ) {
    throw new Error('ground point lies on the registration horizon');
  }
  const result = { x: (a * point.x + b * point.y + c) / denominator, y: (d * point.x + e * point.y + f) / denominator };
  if (![result.x, result.y].every(Number.isFinite)) throw new Error('ground projection exceeds numeric range');
  return result;
}

/** Recover a ground position from a pixel known to lie on the same plane. */
export function fitImageToGround(anchors: readonly Correspondence[]): Homography {
  return fitGroundPlane(anchors.map(({ ground, image }) => ({ ground: image, image: ground })));
}
