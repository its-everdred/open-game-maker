import type { Camera, Object3D, WebGLRenderer } from 'three';
import type Phaser from 'phaser';

import { blurForDepth, type FocusConfig } from '../focus/index.js';
import { sampleShaftIntensity, type LightingPreset } from '../lighting/index.js';
import { createParticlePool, FIXED_STEP_MS, type EmitOptions, type ParticleHandle, type ParticlePool } from './pool.js';
import { PARTICLE_PRESETS } from './presets.js';
import { LEAF_SIZE } from './textures.js';
import { PARTICLE_LIMITS, type ParticleEffect } from './schema.js';
import { createWindField, type WindField, type WindSettings } from './wind.js';
import { createPhaserParticles } from './phaser.js';
import { createThreeParticles } from './three.js';

export type ParticleQuality = 'off' | 'low' | 'high';

/**
 * Where particles draw. Pool units are y-up; Phaser maps them to screen pixels (`scale` pixels per unit, y flipped),
 * three.js draws them in `parent`'s space (the scene by default), so a scaled group sets the units.
 */
export type ParticlesTarget =
  | { phaser: { scene: Phaser.Scene; scale?: number } }
  | { three: { renderer: WebGLRenderer; scene: Object3D; camera: Camera; parent?: Object3D } };

export interface ParticlesOptions {
  wind?: WindSettings;
  effects?: Readonly<Record<string, ParticleEffect>>;
  quality?: ParticleQuality;
  seed?: number;
  /** Soft motes take their light from this preset's shafts. */
  lighting?: LightingPreset;
  /** Soft motes away from `depth` (0 far .. 1 near) grow and fade by the focus core's blur. */
  focus?: { config: FocusConfig; depth: number };
}

export interface Particles {
  emit(name: string, options: EmitOptions): ParticleHandle;
  setWind(wind: Partial<WindSettings>): void;
  setQuality(quality: ParticleQuality): void;
  update(timeMs: number): void;
  dispose(): void;
  /** Particles drawn by the last update. */
  readonly drawn: number;
}

/** 0 = pixel leaf, 1 = soft mote (the pool's `family` values). */
export type Family = 0 | 1;

/** What a renderer backend implements; the driver owns simulation, colour, light and focus. */
export interface ParticleBackend {
  /** Called once per frame before any `screen` or `draw`. */
  begin(): void;
  /**
   * Writes the pool position's screen position (0..1, y down) and pixels per pool unit into `out`, and may write the
   * view's width / height into `out[3]` so motes take their light from the same short beams the lighting draws.
   */
  screen(x: number, y: number, z: number, out: Float64Array): void;
  draw(
    family: Family,
    slot: number,
    x: number,
    y: number,
    z: number,
    rot: number,
    size: number,
    alpha: number,
    color: number,
  ): void;
  /** Hides every slot at or past the drawn counts. */
  end(pixel: number, soft: number): void;
  dispose(): void;
}

export const DEFAULT_WIND: WindSettings = { direction: [1, -0.15, 0.2], strength: 0.35, seed: 1 };
/** Alpha a mote keeps outside every shaft: it reads as floating dust only where light catches it. */
export const MOTE_SHADE = 0.3;
/**
 * Extra rate scale at the low tier, on top of the core halving rate and cap: low lands near 40% of high, so its
 * sampling noise stays under the half-of-high budget.
 */
const LOW_DENSITY = 0.8;
/** The core clamps particle speed to 4 units/s; the identity tracker allows that much motion per substep. */
const MAX_SPEED = 4;
/** Leaves flip in quarter turns so their pixels stay on the grid. */
const LEAF_TURN = Math.PI / 2;

/**
 * A soft mote's look: alpha follows the shaft light at its screen position, and out of focus it grows by the blur
 * radius on each side and fades in step, so it reads as a soft disc rather than vanishing. Writes [size, alpha].
 */
export function moteLook(
  options: Pick<ParticlesOptions, 'lighting' | 'focus'>,
  screenX: number,
  screenY: number,
  timeMs: number,
  sizePx: number,
  alpha: number,
  out: Float64Array,
  aspect?: number,
): void {
  const light = options.lighting ? sampleShaftIntensity(options.lighting, screenX, screenY, timeMs, aspect) : 1;
  // HD-2D convention: lower on screen is nearer, like the Phaser depth the focus core reads.
  const blur = options.focus ? blurForDepth(options.focus.config, screenY, options.focus.depth) : 0;
  const grown = sizePx + 2 * blur;
  const spread = sizePx > 0 ? sizePx / grown : 1;
  out[0] = grown;
  out[1] = alpha * (MOTE_SHADE + (1 - MOTE_SHADE) * light) * spread;
}

function effectiveQuality(effect: ParticleQuality, scene: ParticleQuality): ParticleQuality {
  if (effect === 'off' || scene === 'off') return 'off';
  return effect === 'low' || scene === 'low' ? 'low' : 'high';
}

function hexColor(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/**
 * Keeps each particle's palette colour on that particle. The core packs live particles with swap-remove, so a
 * slot can change owner between steps; a particle is matched to the previous slot it is within one step's motion of.
 */
function createIdentity(palette: readonly number[], seed: number) {
  const capacity = PARTICLE_LIMITS.visible;
  let x = new Float32Array(capacity);
  let y = new Float32Array(capacity);
  let z = new Float32Array(capacity);
  let color = new Uint32Array(capacity);
  let nx = new Float32Array(capacity);
  let ny = new Float32Array(capacity);
  let nz = new Float32Array(capacity);
  let ncolor = new Uint32Array(capacity);
  const matched = new Uint8Array(capacity);
  const pending = new Uint16Array(capacity);
  let count = 0;
  let serial = seed >>> 0;
  const near = (views: ParticlePool['views'], index: number, prev: number, tolerance: number) =>
    Math.abs(views.x[index]! - x[prev]!) <= tolerance &&
    Math.abs(views.y[index]! - y[prev]!) <= tolerance &&
    Math.abs(views.z[index]! - z[prev]!) <= tolerance;

  return {
    get color() {
      return color;
    },
    track(views: ParticlePool['views'], steps: number): void {
      const tolerance = (MAX_SPEED * steps * FIXED_STEP_MS) / 1000 + 1e-4;
      matched.fill(0, 0, count);
      const next = views.count;
      let waiting = 0;
      for (let index = 0; index < next; index += 1) {
        if (index < count && near(views, index, index, tolerance)) {
          matched[index] = 1;
          ncolor[index] = color[index]!;
        } else pending[waiting++] = index;
      }
      for (let at = 0; at < waiting; at += 1) {
        const index = pending[at]!;
        let found = -1;
        for (let prev = 0; prev < count && found < 0; prev += 1)
          if (!matched[prev] && near(views, index, prev, tolerance)) found = prev;
        if (found >= 0) {
          matched[found] = 1;
          ncolor[index] = color[found]!;
        } else {
          // A new particle: a deterministic walk through the palette.
          serial = (Math.imul(serial, 1664525) + 1013904223) >>> 0;
          ncolor[index] = palette[serial % palette.length]!;
        }
      }
      for (let index = 0; index < next; index += 1) {
        nx[index] = views.x[index]!;
        ny[index] = views.y[index]!;
        nz[index] = views.z[index]!;
      }
      [x, nx] = [nx, x];
      [y, ny] = [ny, y];
      [z, nz] = [nz, z];
      [color, ncolor] = [ncolor, color];
      count = next;
    },
  };
}

interface Emission {
  name: string;
  effect: ParticleEffect;
  at: EmitOptions['at'];
  intensity: number;
  ordinal: number;
  pool: ParticlePool;
  inner: ParticleHandle;
  identity: ReturnType<typeof createIdentity>;
  stopped: boolean;
}

/** Drives the core particle pool and draws it with a Phaser 4 or three.js backend; the target's key picks it. */
export function createParticles(target: ParticlesTarget, options: ParticlesOptions = {}): Particles {
  const backend =
    'phaser' in target
      ? createPhaserParticles(target.phaser)
      : 'three' in target
        ? createThreeParticles(target.three)
        : undefined;
  if (!backend) throw new Error('createParticles needs a { phaser } or { three } target');
  return createParticleDriver(backend, options);
}

export function createParticleDriver(backend: ParticleBackend, options: ParticlesOptions = {}): Particles {
  const effects = options.effects ?? PARTICLE_PRESETS;
  const seed = options.seed ?? 1;
  const wind: WindField = createWindField(options.wind ?? DEFAULT_WIND);
  let quality: ParticleQuality = options.quality ?? 'high';
  const emissions: Emission[] = [];
  let ordinals = 0;
  let lastTime: number | undefined;
  let drawn = 0;
  const point = new Float64Array(4);
  const look = new Float64Array(2);

  /** One pool per emit, prewarmed through a full lifetime so ambient effects start already in the air. */
  function start(emission: Omit<Emission, 'pool' | 'inner' | 'identity'>): Emission {
    const tier = effectiveQuality(emission.effect.quality, quality);
    const effect = {
      ...emission.effect,
      seed: emission.effect.seed + seed * 7919 + emission.ordinal * 104729,
      rate: emission.effect.rate * (tier === 'low' ? LOW_DENSITY : 1),
      quality: tier,
    };
    const pool = createParticlePool({ [emission.name]: effect }, wind);
    const inner = pool.emit(emission.name, { at: emission.at, intensity: emission.intensity });
    const palette = (emission.effect.palette ?? ['#ffffff']).map(hexColor);
    const identity = createIdentity(palette, effect.seed);
    if (effect.quality !== 'off')
      for (let ms = 0; ms < emission.effect.lifetime[1] * 1000; ms += FIXED_STEP_MS)
        identity.track(pool.views, pool.step(FIXED_STEP_MS));
    return { ...emission, pool, inner, identity };
  }

  return {
    get drawn() {
      return drawn;
    },
    emit(name, emitOptions) {
      const effect = effects[name];
      if (!effect) throw new RangeError(`unknown particle effect: ${name}`);
      if (emissions.length >= PARTICLE_LIMITS.emitters)
        throw new RangeError(`particle emitter limit is ${PARTICLE_LIMITS.emitters}`);
      const emission = start({
        name,
        effect,
        at: [...emitOptions.at],
        intensity: emitOptions.intensity ?? 1,
        ordinal: ordinals++,
        stopped: false,
      });
      emissions.push(emission);
      return {
        stop() {
          emission.stopped = true;
          emission.inner.stop();
        },
        setIntensity(value) {
          emission.inner.setIntensity(value);
          emission.intensity = value;
        },
        dispose() {
          const index = emissions.indexOf(emission);
          if (index >= 0) emissions.splice(index, 1);
        },
      };
    },
    setWind(next) {
      wind.set(next);
    },
    setQuality(next) {
      if (next === quality) return;
      quality = next;
      // Tiers change rate and cap inside the pool, so live emitters restart (prewarmed) at the new tier.
      for (let index = 0; index < emissions.length; index += 1) {
        const old = emissions[index]!;
        if (old.stopped) emissions.splice(index--, 1);
        else Object.assign(old, start(old));
      }
    },
    update(timeMs) {
      const dt = lastTime === undefined ? 0 : Math.max(0, timeMs - lastTime);
      lastTime = timeMs;
      backend.begin();
      let pixel = 0;
      let soft = 0;
      for (let at = 0; at < emissions.length; at += 1) {
        const emission = emissions[at]!;
        const steps = emission.pool.step(dt);
        if (steps > 0) emission.identity.track(emission.pool.views, steps);
        const { x, y, z, rot, size, alpha, family, count } = emission.pool.views;
        // A stopped emitter frees its slot once its last particle is gone.
        if (emission.stopped && count === 0) {
          emissions.splice(at--, 1);
          continue;
        }
        const colors = emission.identity.color;
        for (let index = 0; index < count; index += 1) {
          if (pixel + soft >= PARTICLE_LIMITS.visible) break;
          const isSoft = family[index] === 1;
          if (isSoft && soft >= PARTICLE_LIMITS.soft) continue;
          // The core fades alpha over the whole life; hold it opaque, fading in over the first sixth and out over the last quarter.
          const life = Math.min(1, alpha[index]! * 4, (1 - alpha[index]!) * 6);
          backend.screen(x[index]!, y[index]!, z[index]!, point);
          if (isSoft) {
            moteLook(
              options,
              point[0]!,
              point[1]!,
              timeMs,
              size[index]! * point[2]!,
              life,
              look,
              point[3]! || undefined,
            );
            backend.draw(1, soft++, x[index]!, y[index]!, z[index]!, 0, look[0]! / point[2]!, look[1]!, colors[index]!);
          } else {
            const turn = Math.round(rot[index]! / LEAF_TURN) * LEAF_TURN;
            // Whole texels on screen, so the nearest-sampled leaf keeps every pixel.
            const texels = Math.max(1, Math.round((size[index]! * point[2]!) / LEAF_SIZE)) * LEAF_SIZE;
            backend.draw(0, pixel++, x[index]!, y[index]!, z[index]!, turn, texels / point[2]!, life, colors[index]!);
          }
        }
      }
      backend.end(pixel, soft);
      drawn = pixel + soft;
    },
    dispose() {
      emissions.length = 0;
      backend.dispose();
    },
  };
}
