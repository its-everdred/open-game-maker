import type { LightingPreset } from './schema.js';

type Shafts = NonNullable<LightingPreset['shafts']>;
type Clouds = NonNullable<LightingPreset['clouds']>;

/** Beams start just above the top edge so they enter the screen already formed. */
const BEAM_TOP = -0.05;
/** Ground pools are flattened ellipses: the ground recedes, as in isometric and tilted views. */
const POOL_SQUASH = 0.5;
/** A pool is this many beam widths across. */
const POOL_WIDTHS = 2.6;

/** A stable 0..1 value per beam index and salt, so beams keep their place from frame to frame. */
function unit(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Several short sun shafts, each ending in a lit patch on the ground: `shafts.count` beams fall along `direction` and
 * stop at `reach` of the screen height or above. `x` and `y` are 0..1 of the view; `aspect` is its width / height.
 */
export function sampleShaftBeams(shafts: Shafts, x: number, y: number, timeMs: number, aspect: number): number {
  const count = shafts.count ?? 1;
  const reach = shafts.reach ?? 0.45;
  const width = shafts.width ?? 0.035;
  const pool = shafts.pool ?? 0.8;
  const dx = Math.cos(shafts.direction);
  // Shafts always fall: a near-horizontal direction is steepened so a beam cannot run along the top edge forever.
  const dy = Math.max(0.3, Math.sin(shafts.direction));
  const norm = Math.hypot(dx, dy);
  const ux = dx / norm;
  const uy = dy / norm;
  const px = x * aspect;
  // Narrow (portrait) views have less room across, so their beams thin out instead of merging.
  const narrow = Math.min(1, Math.sqrt(aspect / (16 / 9)));
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    // Ends spread across the view with some jitter, each at its own depth no lower than `reach`.
    const endX = (0.08 + (0.84 * (i + 0.3 + 0.4 * unit(i, 1))) / count) * aspect;
    const endY = reach * (0.65 + 0.35 * unit(i, 2));
    const length = (endY - BEAM_TOP) / uy;
    const startX = endX - ux * length;
    const startY = endY - uy * length;
    const rx = px - startX;
    const ry = y - startY;
    const along = rx * ux + ry * uy;
    const across = -rx * uy + ry * ux;
    const t = along / length;
    const w = width * narrow * (0.6 + 0.8 * unit(i, 3)) * (0.7 + 0.5 * t);
    const shimmer = 0.8 + 0.2 * Math.sin(Math.max(0, timeMs) * 0.0007 + i * 2.39);
    if (t > -0.05 && t < 1.05 && Math.abs(across) < 2 * w) {
      const core = Math.exp(-3 * (across / w) ** 2);
      const fade = smoothstep(0, 0.25, t) * (1 - 0.45 * t) * (1 - smoothstep(0.9, 1.04, t));
      total += core * fade * shimmer;
    }
    if (pool > 0) {
      const radius = w * POOL_WIDTHS;
      const ex = (px - endX) / radius;
      const ey = (y - endY) / (radius * POOL_SQUASH);
      const r2 = ex * ex + ey * ey;
      if (r2 < 1) total += pool * (1 - r2) ** 2 * shimmer;
    }
  }
  return Math.min(1, total) * shafts.intensity;
}

/** Hash of an integer lattice point to 0..1, varied by seed. */
function lattice(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374_761_393) ^ Math.imul(iy, 668_265_263) ^ Math.imul(seed, 2_147_483_647);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = lattice(ix, iy, seed) * (1 - sx) + lattice(ix + 1, iy, seed) * sx;
  const bottom = lattice(ix, iy + 1, seed) * (1 - sx) + lattice(ix + 1, iy + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}

/**
 * Cloud cover at a view point, 0 (clear sky, sunny ground) to 1 (under a cloud). Soft blobs about `scale` view heights
 * across drift along `direction` at `speed` view heights per second; `coverage` is the share of ground in shadow.
 */
export function sampleCloudCover(
  clouds: Clouds,
  x: number,
  y: number,
  timeMs: number,
  aspect: number,
  seed: number,
): number {
  const drift = (Math.max(0, timeMs) / 1000) * clouds.speed;
  const direction = clouds.direction ?? 0.3;
  const cx = (x * aspect - Math.cos(direction) * drift) / clouds.scale;
  const cy = (y - Math.sin(direction) * drift) / clouds.scale;
  const noise = 0.7 * valueNoise(cx, cy, seed) + 0.3 * valueNoise(cx * 2.3 + 17, cy * 2.3 + 5, seed + 1);
  const threshold = 1 - clouds.coverage;
  return smoothstep(threshold - 0.12, threshold + 0.12, noise);
}
