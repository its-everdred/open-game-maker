/** CIE76 and block SSIM for equally sized sRGB screenshots. */
export type PixelMask = { x: number; y: number; width: number; height: number };

export function glassMetrics(
  reference: Uint8Array,
  actual: Uint8Array,
  width: number,
  height: number,
  masks: PixelMask[] = [],
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    reference.length !== width * height * 3 ||
    actual.length !== reference.length
  ) {
    throw new Error('Expected equally sized RGB images');
  }
  for (const mask of masks) {
    if (
      ![mask.x, mask.y, mask.width, mask.height].every(Number.isInteger) ||
      mask.x < 0 ||
      mask.y < 0 ||
      mask.width < 1 ||
      mask.height < 1 ||
      mask.x + mask.width > width ||
      mask.y + mask.height > height
    )
      throw new Error('Invalid mask');
  }
  let count = 0,
    changed = 0,
    weightedSsim = 0;
  for (let by = 0; by < height; by += 8)
    for (let bx = 0; bx < width; bx += 8) {
      const xs: number[] = [],
        ys: number[] = [];
      for (let y = by; y < Math.min(by + 8, height); y++)
        for (let x = bx; x < Math.min(bx + 8, width); x++) {
          if (masks.some((m) => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)) continue;
          const i = (y * width + x) * 3;
          const a = [reference[i]!, reference[i + 1]!, reference[i + 2]!];
          const b = [actual[i]!, actual[i + 1]!, actual[i + 2]!];
          if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) {
            const labA = lab(a),
              labB = lab(b);
            if (Math.hypot(labA[0]! - labB[0]!, labA[1]! - labB[1]!, labA[2]! - labB[2]!) > 3) changed++;
          }
          xs.push(0.2126 * a[0]! + 0.7152 * a[1]! + 0.0722 * a[2]!);
          ys.push(0.2126 * b[0]! + 0.7152 * b[1]! + 0.0722 * b[2]!);
        }
      const n = xs.length;
      if (!n) continue;
      const mx = xs.reduce((a, b) => a + b, 0) / n,
        my = ys.reduce((a, b) => a + b, 0) / n;
      let vx = 0,
        vy = 0,
        cov = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i]! - mx,
          dy = ys[i]! - my;
        vx += dx * dx;
        vy += dy * dy;
        cov += dx * dy;
      }
      vx /= n;
      vy /= n;
      cov /= n;
      weightedSsim +=
        (n * ((2 * mx * my + 6.5025) * (2 * cov + 58.5225))) / ((mx * mx + my * my + 6.5025) * (vx + vy + 58.5225));
      count += n;
    }
  if (!count) throw new Error('Masks cover the entire image');
  return { ssim: weightedSsim / count, deltaEOver3Percent: (changed / count) * 100 };
}

function lab(rgb: number[]): number[] {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const f = (v: number) => (v > 216 / 24389 ? Math.cbrt(v) : ((24389 / 27) * v + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
