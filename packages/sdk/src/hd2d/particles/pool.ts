import { SeededRng } from '../../core/rng.js';
import { PARTICLE_LIMITS, type ParticleEffect } from './schema.js';
import type { WindField } from './wind.js';

export const FIXED_STEP_MS = 1000 / 60;
export const MAX_SUBSTEPS = 4;
const MAX_SPEED = 4;

/** Live particles are packed into indices `[0, count)`; adapters draw that range. */
export interface ParticleViews {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly rot: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  /** 0 = pixel, 1 = soft. */
  readonly family: Uint8Array;
  readonly count: number;
}

export interface EmitOptions {
  at: readonly [x: number, y: number, z: number];
  intensity?: number;
}

export interface ParticleHandle {
  /** Stops spawning; live particles finish their lifetime. */
  stop(): void;
  setIntensity(intensity: number): void;
  /** Stops spawning and removes this emitter's particles now. */
  dispose(): void;
}

interface Emitter {
  effect: ParticleEffect;
  rng: SeededRng;
  at: [number, number, number];
  intensity: number;
  accumulator: number;
  active: boolean;
  live: number;
  cap: number;
  /** Wind at the emitter, sampled once per substep (noise calls allocate, so not per particle). */
  gust: [number, number, number];
}

export interface ParticlePool {
  readonly views: ParticleViews;
  /** Advances in fixed 1000/60 ms substeps (at most 4) and returns how many ran. */
  step(dtMs: number): number;
  emit(name: string, options: EmitOptions): ParticleHandle;
}

function checkIntensity(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('emitter intensity must be non-negative');
  return value;
}

export function createParticlePool(effects: Readonly<Record<string, ParticleEffect>>, wind?: WindField): ParticlePool {
  const capacity = PARTICLE_LIMITS.visible;
  const x = new Float32Array(capacity);
  const y = new Float32Array(capacity);
  const z = new Float32Array(capacity);
  const vx = new Float32Array(capacity);
  const vy = new Float32Array(capacity);
  const vz = new Float32Array(capacity);
  const age = new Float32Array(capacity);
  const life = new Float32Array(capacity);
  const rot = new Float32Array(capacity);
  const spin = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  const alpha = new Float32Array(capacity);
  const family = new Uint8Array(capacity);
  const owner = new Uint8Array(capacity);
  const slots: (Emitter | null)[] = new Array<Emitter | null>(PARTICLE_LIMITS.emitters).fill(null);
  let emitted = 0;
  const columns = [x, y, z, vx, vy, vz, age, life, rot, spin, size, alpha, family, owner];
  let accumulator = 0;
  let timeMs = 0;
  let count = 0;
  let soft = 0;

  const views: ParticleViews = {
    x,
    y,
    z,
    rot,
    size,
    alpha,
    family,
    get count() {
      return count;
    },
  };

  function between(rng: SeededRng, min: number, max: number): number {
    return min + rng.next() * (max - min);
  }

  function spawn(slot: number, emitter: Emitter): void {
    const { effect, rng } = emitter;
    const index = count;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (effect.emitter.shape === 'box') {
      const box = effect.emitter.size;
      ox = between(rng, -box[0] / 2, box[0] / 2);
      oy = between(rng, -box[1] / 2, box[1] / 2);
      oz = between(rng, -box[2] / 2, box[2] / 2);
    } else if (effect.emitter.shape === 'circle') {
      const angle = rng.next() * Math.PI * 2;
      const radius = Math.sqrt(rng.next()) * effect.emitter.radius;
      ox = Math.cos(angle) * radius;
      oz = Math.sin(angle) * radius;
    }
    x[index] = emitter.at[0] + ox;
    y[index] = emitter.at[1] + oy;
    z[index] = emitter.at[2] + oz;
    vx[index] = between(rng, effect.velocity.x[0], effect.velocity.x[1]);
    vy[index] = between(rng, effect.velocity.y[0], effect.velocity.y[1]);
    vz[index] = between(rng, effect.velocity.z[0], effect.velocity.z[1]);
    age[index] = 0;
    life[index] = between(rng, effect.lifetime[0], effect.lifetime[1]);
    rot[index] = rng.next() * Math.PI * 2;
    spin[index] = between(rng, -1, 1);
    size[index] = effect.family === 'pixel' ? 0.12 : 0.2;
    alpha[index] = 1;
    family[index] = effect.family === 'soft' ? 1 : 0;
    owner[index] = slot;
    emitter.live += 1;
    if (effect.family === 'soft') soft += 1;
    count += 1;
  }

  // Swap-remove keeps live particles packed in [0, count).
  function kill(index: number): void {
    const emitter = slots[owner[index]!]!;
    emitter.live -= 1;
    if (family[index] === 1) soft -= 1;
    count -= 1;
    if (!emitter.active && emitter.live === 0) slots[owner[index]!] = null;
    if (index === count) return;
    for (let column = 0; column < columns.length; column += 1) columns[column]![index] = columns[column]![count]!;
  }

  function stepOne(seconds: number): void {
    timeMs += seconds * 1000;
    if (wind) {
      for (let slot = 0; slot < slots.length; slot += 1) {
        const emitter = slots[slot];
        if (emitter) wind.sample(emitter.at[0], emitter.at[1], emitter.at[2], timeMs, emitter.gust);
      }
    }
    for (let index = count - 1; index >= 0; index -= 1) {
      age[index] += seconds;
      if (age[index]! >= life[index]!) {
        kill(index);
        continue;
      }
      const emitter = slots[owner[index]!]!;
      const effect = emitter.effect;
      vx[index] += effect.gravity[0] * seconds;
      vy[index] += effect.gravity[1] * seconds;
      vz[index] += effect.gravity[2] * seconds;
      if (wind && effect.windResponse > 0) {
        vx[index] += emitter.gust[0] * effect.windResponse * seconds;
        vy[index] += emitter.gust[1] * effect.windResponse * seconds;
        vz[index] += emitter.gust[2] * effect.windResponse * seconds;
      }
      // Clamp speed so a gust cannot fling particles out of legibility.
      const speed = Math.hypot(vx[index]!, vy[index]!, vz[index]!);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        vx[index] *= scale;
        vy[index] *= scale;
        vz[index] *= scale;
      }
      x[index] += vx[index]! * seconds;
      y[index] += vy[index]! * seconds;
      z[index] += vz[index]! * seconds;
      rot[index] += spin[index]! * seconds;
      alpha[index] = 1 - age[index]! / life[index]!;
    }
    for (let slot = 0; slot < slots.length; slot += 1) {
      const emitter = slots[slot];
      if (!emitter?.active) continue;
      const tier = emitter.effect.quality === 'low' ? 0.5 : 1;
      emitter.accumulator += emitter.effect.rate * emitter.intensity * tier * seconds;
      const isSoft = emitter.effect.family === 'soft';
      while (emitter.accumulator >= 1) {
        emitter.accumulator -= 1;
        if (count >= capacity || emitter.live >= emitter.cap || (isSoft && soft >= PARTICLE_LIMITS.soft)) {
          emitter.accumulator = 0;
          break;
        }
        spawn(slot, emitter);
      }
    }
  }

  return {
    views,
    step(dtMs) {
      if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError('particle step must be finite and non-negative');
      accumulator += dtMs;
      let steps = 0;
      while (accumulator >= FIXED_STEP_MS && steps < MAX_SUBSTEPS) {
        stepOne(FIXED_STEP_MS / 1000);
        accumulator -= FIXED_STEP_MS;
        steps += 1;
      }
      // Drop the backlog a long frame leaves rather than spiralling.
      if (accumulator >= FIXED_STEP_MS) accumulator %= FIXED_STEP_MS;
      return steps;
    },
    emit(name, options) {
      const effect = effects[name];
      if (!effect) throw new RangeError(`unknown particle effect: ${name}`);
      if (options.at.length !== 3 || !options.at.every(Number.isFinite)) {
        throw new RangeError('emitter position must be finite');
      }
      const intensity = checkIntensity(options.intensity ?? 1);
      const off = effect.quality === 'off';
      const slot = off ? -1 : slots.indexOf(null);
      if (!off && slot < 0) throw new RangeError(`particle emitter limit is ${PARTICLE_LIMITS.emitters}`);
      const emitter: Emitter = {
        effect,
        /* Each emit gets its own deterministic stream; the first matches effect.seed. */
        rng: new SeededRng(effect.seed + emitted++ * 0x9e3779b9),
        at: [options.at[0], options.at[1], options.at[2]],
        intensity,
        accumulator: 0,
        active: !off,
        live: 0,
        cap: effect.quality === 'low' ? Math.floor(effect.count / 2) : effect.count,
        gust: [0, 0, 0],
      };
      if (!off) slots[slot] = emitter;
      const stop = () => {
        emitter.active = false;
        if (emitter.live === 0 && slots[slot] === emitter) slots[slot] = null;
      };
      return {
        stop,
        setIntensity(value) {
          emitter.intensity = checkIntensity(value);
        },
        dispose() {
          if (slots[slot] !== emitter) return;
          emitter.active = false;
          for (let index = count - 1; index >= 0; index -= 1) if (owner[index] === slot) kill(index);
          slots[slot] = null;
        },
      };
    },
  };
}
