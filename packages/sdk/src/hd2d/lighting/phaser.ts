import type Phaser from 'phaser';
import { flickerAt } from './flicker.js';
import { FIELD_SIZE, gradeMatrix, hexToRgb01, renderLightField } from './field.js';
import type { Lighting, LightingLight, LightingOptions, NormalSource, ScreenLight } from './field.js';
import { maxLightsFor, type LightingPreset, type LightingQuality } from './schema.js';

// Phaser enum values, inlined so this module needs only Phaser's types (BlendModes.ADD / MULTIPLY, FilterMode.LINEAR).
const ADD = 1;
const MULTIPLY = 2;
const LINEAR = 0;
const OVERLAY_DEPTH = 1e9;
// Lit sprites keep most of their own colour; the scene-wide ambient tint comes from the grade.
const NATIVE_AMBIENT = 0xcccccc;

let instances = 0;

interface Overlay {
  texture: Phaser.Textures.CanvasTexture;
  image: Phaser.GameObjects.Image;
  pixels: ImageData;
}

/**
 * Phaser 4 lighting: the native LightsManager lights normal-mapped sprites; one low-resolution light field is
 * stretched over the camera as a multiply (shade) and an add (light) overlay; a camera colour matrix grades it.
 */
export function createPhaserLighting(
  target: { scene: Phaser.Scene },
  initial: LightingPreset,
  { quality: startQuality = 'high', seed = 1 }: LightingOptions = {},
): Lighting {
  const { scene } = target;
  const camera = scene.cameras.main;
  const id = (instances += 1);
  let preset = initial;
  let quality = startQuality;
  let lights: LightingLight[] = [...(initial.lights ?? [])];
  const native: Phaser.GameObjects.Light[] = [];
  const lit = new Set<Phaser.GameObjects.Image>();
  let overlays: { keep: Overlay; light: Overlay } | undefined;
  let grade: Phaser.Filters.ColorMatrix | undefined;
  let field = new Uint8ClampedArray(0);
  // The LightsManager is scene-wide: leave it on (and its ambient alone) if the game already lit the scene.
  const ownsManager = !scene.lights.active;

  function overlay(name: string, width: number, height: number, blend: number): Overlay {
    const key = `hd2d-lighting-${id}-${name}`;
    const texture = scene.textures.createCanvas(key, width, height);
    if (!texture) throw new Error(`could not create lighting texture ${key}`);
    texture.setFilter(LINEAR);
    const image = scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(OVERLAY_DEPTH).setBlendMode(blend);
    return { texture, image, pixels: texture.context.createImageData(width, height) };
  }

  function detach(): void {
    for (const light of native.splice(0)) scene.lights.removeLight(light);
    if (ownsManager) scene.lights.disable();
    for (const sprite of lit) sprite.setLighting(false);
    if (overlays)
      for (const { texture, image } of [overlays.keep, overlays.light]) {
        image.destroy();
        texture.destroy();
      }
    overlays = undefined;
    if (grade) camera.filters.internal.remove(grade, true);
    grade = undefined;
  }

  function setQuality(next: LightingQuality): void {
    detach();
    quality = next;
    if (next === 'off') return;
    if (ownsManager) scene.lights.enable().setAmbientColor(NATIVE_AMBIENT);
    for (const sprite of lit) sprite.setLighting(true);
    const [width, height] = FIELD_SIZE[next];
    field = new Uint8ClampedArray(width * height * 4);
    overlays = { keep: overlay('keep', width, height, MULTIPLY), light: overlay('light', width, height, ADD) };
    grade = camera.filters.internal.addColorMatrix();
    applyGrade();
  }

  function applyGrade(): void {
    if (!grade) return;
    const g = gradeMatrix(preset);
    grade.colorMatrix.set([
      ...[g[0]!, g[1]!, g[2]!, 0, g[3]! * 255],
      ...[g[4]!, g[5]!, g[6]!, 0, g[7]! * 255],
      ...[g[8]!, g[9]!, g[10]!, 0, g[11]! * 255],
      ...[0, 0, 0, 1, 0],
    ]);
  }

  function update(timeMs: number): void {
    if (!overlays) return;
    const active = lights.slice(0, maxLightsFor(quality));
    while (native.length > active.length) scene.lights.removeLight(native.pop()!);
    while (native.length < active.length) native.push(scene.lights.addLight());
    const view = camera.worldView;
    const screen: ScreenLight[] = active.map((light, index) => {
      const amount = light.intensity * (light.flicker ? flickerAt(light.flicker, timeMs) : 1);
      const color = hexToRgb01(light.color);
      native[index]!.setPosition(light.x, light.y)
        .setRadius(light.radius)
        .setColor(Number.parseInt(light.color.slice(1), 16))
        .setIntensity(amount * 2);
      return {
        x: (light.x - view.x) / view.width,
        y: (light.y - view.y) / view.height,
        radius: light.radius / view.height,
        color,
        amount,
        falloff: light.falloff ?? 2,
      };
    });
    const { keep, light } = overlays;
    const { width, height } = keep.pixels;
    renderLightField(field, width, height, preset, timeMs, seed, screen);
    const shade = keep.pixels.data;
    const glow = light.pixels.data;
    for (let i = 0; i < field.length; i += 4) {
      shade[i] = shade[i + 1] = shade[i + 2] = field[i + 3]!;
      glow[i] = field[i]!;
      glow[i + 1] = field[i + 1]!;
      glow[i + 2] = field[i + 2]!;
      shade[i + 3] = glow[i + 3] = 255;
    }
    for (const { texture, pixels, image } of [keep, light]) {
      texture.context.putImageData(pixels, 0, 0);
      texture.refresh();
      // Cover the camera's current world view, so the field follows scroll, zoom and resize.
      image.setPosition(view.x, view.y).setDisplaySize(view.width, view.height);
    }
  }

  function setNormalMap(sprite: unknown, normal: NormalSource): void {
    const image = sprite as Phaser.GameObjects.Image;
    if (typeof image.setLighting !== 'function') throw new Error('Phaser lighting needs an Image or Sprite');
    // The normal map belongs to the texture, so every sprite sharing it shares the map.
    const sources = image.texture.dataSource;
    if (normal === 'flat') for (const source of sources.splice(0)) source.destroy();
    else image.texture.setDataSource(normal);
    lit.add(image);
    image.setLighting(quality !== 'off');
  }

  setQuality(quality);
  return {
    apply(next) {
      preset = next;
      lights = [...(next.lights ?? [])];
      applyGrade();
    },
    addLight(light) {
      lights = [...lights.filter((existing) => existing.id !== light.id), light];
    },
    removeLight(lightId) {
      lights = lights.filter((light) => light.id !== lightId);
    },
    setQuality,
    setNormalMap,
    update,
    dispose() {
      detach();
      lit.clear();
    },
  };
}
