import type { LightingPreset } from './schema.js';

/** Where a scene is and what the sky is doing; games name their own biomes and weathers. */
export interface SkyConditions {
  biome?: string;
  weather?: string;
}

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

/** Whether the preset's shafts may appear under these conditions: each listed `when` set must name the condition. */
export function shaftsActive(shafts: Shafts | undefined, conditions: SkyConditions): boolean {
  if (!shafts) return false;
  const when = shafts.when;
  if (!when) return true;
  const fits = (allowed: string[] | undefined, value: string | undefined) =>
    !allowed || (value !== undefined && allowed.includes(value));
  return fits(when.biomes, conditions.biome) && fits(when.weather, conditions.weather);
}

const withoutShafts = new WeakMap<LightingPreset, LightingPreset>();

/**
 * The preset as the sky allows it right now: the same object, or (stable per preset) a copy whose shafts are dark.
 * The shafts keep their colour, which also tints the dapple and the sunny gaps between clouds.
 */
export function presetUnder(preset: LightingPreset, conditions: SkyConditions): LightingPreset {
  if (!preset.shafts || shaftsActive(preset.shafts, conditions)) return preset;
  let stripped = withoutShafts.get(preset);
  if (!stripped) {
    stripped = { ...preset, shafts: { ...preset.shafts, intensity: 0 } };
    withoutShafts.set(preset, stripped);
  }
  return stripped;
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
  /** 0..1 brightness of this beam. */
  brightness: number;
  /** Whether it reaches the ground and lights a patch there. */
  grounded: boolean;
}

/** One beam from its end point, angle salt and width salt (salts keep fixed and cycling beams on the same hash). */
function makeBeam(
  shafts: Shafts,
  aspect: number,
  end: { x: number; y: number },
  angleSalt: number,
  widthSalt: number,
  brightness: number,
  grounded: boolean,
): Beam {
  // Narrow (portrait) views have less room across, so their beams thin out instead of merging.
  const narrow = Math.min(1, Math.sqrt(aspect / (16 / 9)));
  const angle = shafts.direction + (angleSalt * 2 - 1) * BEAM_SPREAD;
  // Shafts always fall: a near-horizontal direction is steepened so a beam cannot run along the top edge forever.
  const dy = Math.max(0.3, Math.sin(angle));
  const norm = Math.hypot(Math.cos(angle), dy);
  const ux = Math.cos(angle) / norm;
  const uy = dy / norm;
  const length = (end.y - BEAM_TOP) / uy;
  const width = (shafts.width ?? 0.035) * narrow * (0.6 + 0.8 * widthSalt);
  return {
    startX: end.x - ux * length,
    startY: end.y - uy * length,
    ux,
    uy,
    length,
    width,
    endX: end.x,
    endY: end.y,
    // The beam's width where it lands (it widens to 1.2x), times the pool's spread.
    poolRadius: width * 1.2 * POOL_WIDTHS,
    brightness,
    grounded,
  };
}

interface BeamCache {
  aspect: number;
  /** Fixed beams (no `cycle`). */
  beams: Beam[];
  /** Cycling beams: each slot's current generation and its beam (undefined when that generation shows none). */
  slots: Array<{ generation: number; beam: Beam | undefined }>;
}

/** Beam geometry depends only on the preset's shafts, the view shape and (cycling) the generation: built once each. */
const beamCache = new WeakMap<Shafts, BeamCache>();

function cacheFor(shafts: Shafts, aspect: number): BeamCache {
  const cached = beamCache.get(shafts);
  if (cached && cached.aspect === aspect) return cached;
  const fresh: BeamCache = { aspect, beams: [], slots: [] };
  beamCache.set(shafts, fresh);
  return fresh;
}

function fixedBeams(shafts: Shafts, aspect: number): Beam[] {
  const cache = cacheFor(shafts, aspect);
  if (cache.beams.length) return cache.beams;
  const count = shafts.count ?? 1;
  const reach = shafts.reach ?? 0.45;
  for (let i = 0; i < count; i += 1) {
    // Ends spread across the view with some jitter, each at its own depth no lower than `reach`.
    const end = {
      x: (0.08 + (0.84 * (i + 0.3 + 0.4 * unit(i, 1))) / count) * aspect,
      y: reach * (0.65 + 0.35 * unit(i, 2)),
    };
    cache.beams.push(makeBeam(shafts, aspect, end, unit(i, 4), unit(i, 3), 1, true));
  }
  return cache.beams;
}

/**
 * Kevin: rays come at random, at random places, lengths and brightness, and need not touch the ground. Each slot's
 * generation draws a fresh beam (or none, by `chance`); only grounded beams light a patch.
 */
function cyclingBeam(shafts: Shafts, aspect: number, slot: number, generation: number): Beam | undefined {
  const cache = cacheFor(shafts, aspect);
  const held = cache.slots[slot];
  if (held && held.generation === generation) return held.beam;
  const key = slot * 1009 + generation;
  let beam: Beam | undefined;
  if (unit(key, 15) < (shafts.chance ?? 1)) {
    const reach = shafts.reach ?? 0.45;
    const end = { x: (0.05 + 0.9 * unit(key, 11)) * aspect, y: reach * (0.3 + 0.7 * unit(key, 12)) };
    beam = makeBeam(shafts, aspect, end, unit(key, 4), unit(key, 3), 0.45 + 0.55 * unit(key, 13), unit(key, 14) < 0.5);
  }
  cache.slots[slot] = { generation, beam };
  return beam;
}

/** A cycling slot's generation and its 0..1 fade at `timeMs`. Slots are out of step, so beams come and go one at a time. */
function slotGeneration(cycle: number, slot: number, timeMs: number): number {
  return Math.floor(Math.max(0, timeMs) / 1000 / cycle + unit(slot, 5));
}

function slotEnvelope(cycle: number, slot: number, timeMs: number): number {
  const phase = Math.max(0, timeMs) / 1000 / cycle + unit(slot, 5);
  const life = phase - Math.floor(phase);
  return smoothstep(0, 0.25, life) * (1 - smoothstep(0.7, 1, life));
}

/** Slot `slot`'s beam at `timeMs` and its 0..1 fade (always 1 for fixed beams); undefined while it shows none. */
function slotBeam(
  shafts: Shafts,
  aspect: number,
  slot: number,
  timeMs: number,
): { beam: Beam; fade: number } | undefined {
  const cycle = shafts.cycle;
  const beam =
    cycle === undefined
      ? fixedBeams(shafts, aspect)[slot]
      : cyclingBeam(shafts, aspect, slot, slotGeneration(cycle, slot, timeMs));
  const fade = cycle === undefined ? 1 : slotEnvelope(cycle, slot, timeMs);
  return beam && fade > 0 ? { beam, fade } : undefined;
}

/** The beams showing at `timeMs`: where each ends (0..1 of the view), how bright, whether it lights the ground. */
export function beamsAt(
  shafts: Shafts,
  timeMs: number,
  aspect: number,
): Array<{ x: number; y: number; brightness: number; grounded: boolean; fade: number }> {
  const shown: Array<{ x: number; y: number; brightness: number; grounded: boolean; fade: number }> = [];
  if (shafts.intensity <= 0) return shown;
  for (let i = 0; i < (shafts.count ?? 1); i += 1) {
    const slot = slotBeam(shafts, aspect, i, timeMs);
    if (!slot) continue;
    const { beam, fade } = slot;
    shown.push({ x: beam.endX / aspect, y: beam.endY, brightness: beam.brightness, grounded: beam.grounded, fade });
  }
  return shown;
}

/**
 * Several short sun shafts falling along `direction` and stopping at `reach` of the screen height or above; grounded
 * ones end in a lit patch. With `cycle` they come and go at random. `x` and `y` are 0..1 of the view; `aspect` is its
 * width / height.
 */
export function sampleShaftBeams(shafts: Shafts, x: number, y: number, timeMs: number, aspect: number): number {
  const pool = shafts.pool ?? 0.8;
  const px = x * aspect;
  const count = shafts.count ?? 1;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const slot = slotBeam(shafts, aspect, i, timeMs);
    if (!slot) continue;
    const { beam, fade: envelope } = slot;
    const rx = px - beam.startX;
    const ry = y - beam.startY;
    const t = (rx * beam.ux + ry * beam.uy) / beam.length;
    const across = -rx * beam.uy + ry * beam.ux;
    const w = beam.width * (0.7 + 0.5 * t);
    const ex = (px - beam.endX) / beam.poolRadius;
    const ey = (y - beam.endY) / (beam.poolRadius * POOL_SQUASH);
    const r2 = ex * ex + ey * ey;
    const inBeam = t > -0.05 && t < 1.05 && Math.abs(across) < 2 * w;
    const inPool = beam.grounded && pool > 0 && r2 < 1;
    if (!inBeam && !inPool) continue;
    const shimmer = (0.8 + 0.2 * Math.sin(Math.max(0, timeMs) * 0.0007 + i * 2.39)) * envelope * beam.brightness;
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
