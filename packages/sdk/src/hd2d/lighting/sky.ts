import type { LightingPreset } from './schema.js';

type Shafts = NonNullable<LightingPreset['shafts']>;
type Clouds = NonNullable<LightingPreset['clouds']>;

/** Beams start just above the top edge so they enter the screen already formed. */
const BEAM_TOP = -0.05;
/** Ground pools are flattened ellipses: the ground recedes, as in isometric and tilted views. */
const POOL_SQUASH = 0.5;
/** A pool is this many beam widths across. */
const POOL_WIDTHS = 3.2;
/** A beam's own opacity at its core: shafts read as light in the air, not solid bars. */
const BEAM_CORE = 0.55;
/** How far each beam's angle strays from `direction` (radians, either way), so they are not ruled parallel. */
const BEAM_SPREAD = 0.08;

/** A stable 0..1 value per beam index and salt, so beams keep their place from frame to frame. */
function unit(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43_758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface Beam {
  startX: number;
  startY: number;
  ux: number;
  uy: number;
  length: number;
  /** Width at the top; it widens toward the ground. */
  width: number;
  endX: number;
  endY: number;
  poolRadius: number;
}

/** Beam geometry depends only on the preset's shafts and the view shape, so it is built once per pair, not per pixel. */
const beamCache = new WeakMap<Shafts, { aspect: number; beams: Beam[] }>();

function beamsFor(shafts: Shafts, aspect: number): Beam[] {
  const cached = beamCache.get(shafts);
  if (cached && cached.aspect === aspect) return cached.beams;
  const count = shafts.count ?? 1;
  const reach = shafts.reach ?? 0.45;
  // Narrow (portrait) views have less room across, so their beams thin out instead of merging.
  const narrow = Math.min(1, Math.sqrt(aspect / (16 / 9)));
  const beams: Beam[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = shafts.direction + (unit(i, 4) * 2 - 1) * BEAM_SPREAD;
    // Shafts always fall: a near-horizontal direction is steepened so a beam cannot run along the top edge forever.
    const dy = Math.max(0.3, Math.sin(angle));
    const norm = Math.hypot(Math.cos(angle), dy);
    const ux = Math.cos(angle) / norm;
    const uy = dy / norm;
    // Ends spread across the view with some jitter, each at its own depth no lower than `reach`.
    const endX = (0.08 + (0.84 * (i + 0.3 + 0.4 * unit(i, 1))) / count) * aspect;
    const endY = reach * (0.65 + 0.35 * unit(i, 2));
    const length = (endY - BEAM_TOP) / uy;
    const width = (shafts.width ?? 0.035) * narrow * (0.6 + 0.8 * unit(i, 3));
    beams.push({
      startX: endX - ux * length,
      startY: endY - uy * length,
      ux,
      uy,
      length,
      width,
      endX,
      endY,
      // The beam's width where it lands (it widens to 1.2x), times the pool's spread.
      poolRadius: width * 1.2 * POOL_WIDTHS,
    });
  }
  beamCache.set(shafts, { aspect, beams });
  return beams;
}

/**
 * Several short sun shafts, each ending in a lit patch on the ground: `shafts.count` beams fall along `direction` and
 * stop at `reach` of the screen height or above. `x` and `y` are 0..1 of the view; `aspect` is its width / height.
 */
export function sampleShaftBeams(shafts: Shafts, x: number, y: number, timeMs: number, aspect: number): number {
  const pool = shafts.pool ?? 0.8;
  const px = x * aspect;
  const beams = beamsFor(shafts, aspect);
  let total = 0;
  for (let i = 0; i < beams.length; i += 1) {
    const beam = beams[i]!;
    const rx = px - beam.startX;
    const ry = y - beam.startY;
    const t = (rx * beam.ux + ry * beam.uy) / beam.length;
    const across = -rx * beam.uy + ry * beam.ux;
    const w = beam.width * (0.7 + 0.5 * t);
    const ex = (px - beam.endX) / beam.poolRadius;
    const ey = (y - beam.endY) / (beam.poolRadius * POOL_SQUASH);
    const r2 = ex * ex + ey * ey;
    const inBeam = t > -0.05 && t < 1.05 && Math.abs(across) < 2 * w;
    const inPool = pool > 0 && r2 < 1;
    if (!inBeam && !inPool) continue;
    const shimmer = 0.8 + 0.2 * Math.sin(Math.max(0, timeMs) * 0.0007 + i * 2.39);
    if (inBeam) {
      const core = BEAM_CORE * Math.exp(-3 * (across / w) ** 2);
      // Brightest where the beam breaks through the canopy, thinning as it falls into its pool.
      const fade = smoothstep(0, 0.2, t) * (1 - 0.7 * t) * (1 - smoothstep(0.85, 1.02, t));
      total += core * fade * shimmer;
    }
    if (inPool) {
      // Leaf gaps break the patch up, so it reads as sunlit ground rather than a round spotlight.
      const breakup = 0.45 + 0.55 * valueNoise(ex * 2.5 + i * 7, ey * 2.5, i);
      total += pool * 0.7 * (1 - r2) ** 1.5 * breakup * shimmer;
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
