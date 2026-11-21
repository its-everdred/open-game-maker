import { SeededRng } from '../../core/rng.js';

export interface LightFlicker {
  amount: number;
  rate: number;
  seed: number;
}

/** A smooth, repeatable light multiplier in [1 - amount, 1]. */
export function flickerAt(flicker: LightFlicker, timeMs: number): number {
  if (flicker.amount <= 0) return 1;
  const step = Math.max(0, timeMs) * (flicker.rate / 1000);
  const whole = Math.floor(step);
  const fraction = step - whole;
  const a = flickerSample(flicker.seed, whole);
  const b = flickerSample(flicker.seed, whole + 1);
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return 1 - flicker.amount * (a + (b - a) * smooth);
}

function flickerSample(seed: number, step: number): number {
  const rng = new SeededRng((seed ^ Math.imul(step + 1, 0x9e3779b1)) >>> 0);
  return rng.next();
}
