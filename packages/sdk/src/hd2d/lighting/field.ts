import type { Camera, Mesh, Scene, WebGLRenderer } from 'three';
import type Phaser from 'phaser';
import { DAPPLE_DEPTH, renderDappleMask, sampleShaftIntensity } from './dapple.js';
import type { LightingPreset, LightingQuality } from './schema.js';

type PresetLight = NonNullable<LightingPreset['lights']>[number];
export type LightingLight = PresetLight;
export type LightingSprite = Phaser.GameObjects.Image | Mesh;
export type NormalSource = HTMLCanvasElement | HTMLImageElement | 'flat';
export type LightingTarget =
  { phaser: { scene: Phaser.Scene } } | { three: { renderer: WebGLRenderer; scene: Scene; camera: Camera } };

export interface LightingOptions {
  quality?: LightingQuality;
  seed?: number;
}

export interface Lighting {
  apply(preset: LightingPreset): void;
  addLight(light: LightingLight): void;
  removeLight(id: string): void;
  setQuality(quality: LightingQuality): void;
  setNormalMap(sprite: LightingSprite, normal: NormalSource): void;
  update(timeMs: number): void;
  dispose(): void;
}

/** A light already projected to the screen: x and y in 0..1 of the view, radius in view heights. */
export interface ScreenLight {
  x: number;
  y: number;
  radius: number;
  color: readonly [number, number, number];
  amount: number;
  falloff: number;
}

/** Light-field resolution per tier: the shafts, dapple and light glow are drawn this small and stretched. */
export const FIELD_SIZE = { low: [80, 45], high: [160, 90] } as const;

export function hexToRgb01(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/**
 * Renders the shared low-resolution light field into `out` (RGBA bytes): rgb is light to add, alpha is how much of
 * the scene colour to keep (255 = untouched). Both backends composite it as `scene * keep + light`.
 */
export function renderLightField(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  preset: LightingPreset,
  timeMs: number,
  seed: number,
  lights: readonly ScreenLight[],
): void {
  const dapple = preset.dapple;
  const mask = dapple ? renderDappleMask(dapple, { width, height, timeMs, seed }) : undefined;
  const dappleBase = dapple ? 1 - Math.min(1, Math.max(0, dapple.intensity)) * DAPPLE_DEPTH : 1;
  const sun = hexToRgb01(preset.shafts?.color ?? '#ffffff');
  const aspect = width / height;
  for (let py = 0; py < height; py += 1) {
    const ny = (py + 0.5) / height;
    for (let px = 0; px < width; px += 1) {
      const nx = (px + 0.5) / width;
      const index = py * width + px;
      const shaft = sampleShaftIntensity(preset, nx, ny, timeMs);
      let shade = 0;
      let sunAmount = shaft;
      if (mask && dapple) {
        const m = mask[index]! / 255;
        shade = (1 - m) * 0.6 * (1 - shaft);
        if (m > dappleBase) sunAmount += ((m - dappleBase) / (1 - dappleBase)) * dapple.intensity * 0.5;
      }
      let r = sun[0] * sunAmount;
      let g = sun[1] * sunAmount;
      let b = sun[2] * sunAmount;
      for (const light of lights) {
        const dx = (nx - light.x) * aspect;
        const dy = ny - light.y;
        const reach = dx * dx + dy * dy;
        if (reach >= light.radius * light.radius) continue;
        const distance = Math.sqrt(reach) / light.radius;
        const amount = light.amount * Math.pow(1 - distance, light.falloff);
        r += light.color[0] * amount;
        g += light.color[1] * amount;
        b += light.color[2] * amount;
        shade *= 1 - Math.min(1, amount);
      }
      const o = index * 4;
      out[o] = r * 255;
      out[o + 1] = g * 255;
      out[o + 2] = b * 255;
      out[o + 3] = (1 - shade) * 255;
    }
  }
}

/**
 * The ambient tint and colour grade as one affine colour transform on 0..1 RGB: three rows of
 * `[r, g, b, offset]`. It is the linear form of `gradeColor` applied after the ambient tint.
 */
export function gradeMatrix(preset: LightingPreset): number[] {
  const ambient = hexToRgb01(preset.ambient.color);
  const level = 0.75 + 0.25 * preset.ambient.intensity;
  const tint = ambient.map((channel) => (0.6 + 0.4 * channel) * level);
  const { temperature = 0, saturation = 1, contrast = 1 } = preset.grade ?? {};
  const t = Math.max(-1, Math.min(1, temperature));
  const warm = [(t * 18) / 255, (t * 2) / 255, (-t * 18) / 255];
  const luma = [0.2126, 0.7152, 0.0722];
  const rows: number[] = [];
  for (let c = 0; c < 3; c += 1) {
    for (let j = 0; j < 3; j += 1)
      rows.push(contrast * ((c === j ? saturation : 0) + (1 - saturation) * luma[j]!) * tint[j]!);
    rows.push(0.5 - 0.5 * contrast + warm[c]!);
  }
  return rows;
}
