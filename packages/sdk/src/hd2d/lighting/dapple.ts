import { SeededRng } from '../../core/rng.js';
import type { LightingPreset } from './schema.js';
import { sampleShaftBeams } from './sky.js';

/** How far the canopy darkens the clearing at full dapple intensity. */
export const DAPPLE_DEPTH = 0.62;

export interface DappleMaskSettings {
  scale: number;
  speed: number;
  intensity: number;
}

export interface DappleMaskOptions {
  width: number;
  height: number;
  timeMs: number;
  seed: number;
}

/** Draws a deterministic low-resolution canopy cookie with slowly drifting leaf breaks. */
export function renderDappleMask(
  dapple: DappleMaskSettings,
  { width, height, timeMs, seed }: DappleMaskOptions,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(Math.max(0, width * height));
  if (width <= 0 || height <= 0) return output;

  const rng = new SeededRng(seed);
  const count = Math.max(8, Math.round((width * height) / 150));
  const drift = (Math.max(0, timeMs) * dapple.speed) / 1000;
  const spots: Array<{ x: number; y: number; radius: number; value: number }> = [];
  for (let i = 0; i < count; i++) {
    spots.push({
      x: rng.next() * width,
      y: rng.next() * height,
      radius: Math.min(
        Math.hypot(width, height),
        Math.max(1, Math.sqrt(width * height) * dapple.scale * (0.015 + rng.next() * 0.025)),
      ),
      value: rng.next() < 0.28 ? 255 : 0,
    });
  }

  const base = Math.round(255 * (1 - clamp01(dapple.intensity) * DAPPLE_DEPTH));
  output.fill(base);
  for (const spot of spots) {
    const cx = (spot.x + drift * 0.7) % width;
    const cy = (spot.y + drift * 0.31) % height;
    const r2 = spot.radius * spot.radius;
    const left = Math.floor(cx - spot.radius);
    const right = Math.ceil(cx + spot.radius);
    const top = Math.floor(cy - spot.radius);
    const bottom = Math.ceil(cy + spot.radius);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const dx = wrappedDistance(x + 0.5, cx, width);
        const dy = wrappedDistance(y + 0.5, cy, height);
        const distance = dx * dx + dy * dy;
        if (distance > r2) continue;
        const index = ((y + height) % height) * width + ((x + width) % width);
        const edge = 1 - Math.sqrt(distance / r2);
        const blend = clamp01(edge * 0.8 * dapple.intensity);
        output[index] = Math.round(output[index]! * (1 - blend) + spot.value * blend);
      }
    }
  }
  return output;
}

/**
 * Returns the soft shaft contribution at normalized scene coordinates. `aspect` (view width / height) keeps short beams
 * (`shafts.count`) the same shape on any screen; the single wide wash ignores it.
 */
export function sampleShaftIntensity(
  preset: LightingPreset,
  x: number,
  y: number,
  timeMs: number,
  aspect = 16 / 9,
): number {
  const shafts = preset.shafts;
  if (!shafts || shafts.intensity <= 0) return 0;
  if (shafts.count !== undefined) return sampleShaftBeams(shafts, x, y, timeMs, aspect);
  const dx = Math.cos(shafts.direction);
  const dy = Math.sin(shafts.direction);
  const projection = x * dx + y * dy;
  const across = -x * dy + y * dx;
  const phase = across * 9 + projection * 0.55 + Math.max(0, timeMs) * 0.00012;
  const beam = Math.pow(Math.max(0, Math.cos(phase)), 12);
  const verticalFade = clamp01((1 - y) * 1.5);
  return clamp01(beam * verticalFade * shafts.intensity);
}

function wrappedDistance(value: number, center: number, size: number): number {
  const distance = Math.abs(value - center) % size;
  return Math.min(distance, size - distance);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
