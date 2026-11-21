import { createNoise } from '../../proc/noise.js';

export type Vec3 = readonly [x: number, y: number, z: number];

export interface WindSettings {
  direction: Vec3;
  strength: number;
  seed: number;
}

export interface WindField {
  /** Wind at a world position and time. Pass `out` to reuse a vector instead of allocating one. */
  sample(x: number, y: number, z: number, timeMs: number, out?: [number, number, number]): Vec3;
  set(settings: Partial<WindSettings>): void;
}

// Noise cells per world unit and per second: broad, slow gusts.
const SPATIAL_SCALE = 0.06;
const TIME_SCALE = 0.25;

function validate(settings: WindSettings): void {
  if (!settings.direction.every(Number.isFinite) || !Number.isFinite(settings.strength) || settings.strength < 0) {
    throw new RangeError('wind direction must be finite and strength must be non-negative');
  }
  if (!Number.isFinite(settings.seed)) throw new RangeError('wind seed must be finite');
}

export function createWindField(initial: WindSettings): WindField {
  validate(initial);
  let settings: WindSettings = { ...initial, direction: [...initial.direction] };
  let noise = createNoise(settings.seed, { frequency: 1 });

  return {
    sample(x, y, z, timeMs, out = [0, 0, 0]) {
      const { direction, strength } = settings;
      const t = (timeMs / 1000) * TIME_SCALE;
      const px = x * SPATIAL_SCALE;
      const py = y * SPATIAL_SCALE;
      const pz = z * SPATIAL_SCALE;
      const gust = noise.at3(px + t, py, pz - t * 0.6);
      const cross = noise.at3(px - t * 0.4 + 17, py + t * 0.3, pz + 9);
      const amplitude = strength * (0.72 + 0.28 * gust);
      out[0] = direction[0] * amplitude + cross * strength * 0.18;
      out[1] = direction[1] * amplitude;
      out[2] = direction[2] * amplitude - cross * strength * 0.18;
      return out;
    },
    set(update) {
      const next = { ...settings, ...update };
      validate(next);
      if (next.seed !== settings.seed) noise = createNoise(next.seed, { frequency: 1 });
      settings = { ...next, direction: [...next.direction] };
    },
  };
}
