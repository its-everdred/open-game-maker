import Phaser from 'phaser';

import { createFocus, type Focus } from '../../../../packages/sdk/src/hd2d/focus/index.js';
import { createLighting, type Lighting, type LightingLight } from '../../../../packages/sdk/src/hd2d/lighting/index.js';
import { fallbackTexture, HERO_FRAME, TEXTURES } from './art.js';
import { cellPoint, clearingPieces, depthBands, FIRE, HERO, HERO_DEPTH } from './clearing.js';
import { normalCanvas } from './normals.js';
import { createForestParticles, swayAt, worldToCell, type ForestParticles } from './particles.js';
import { FOCUS, PRESETS, type PresetId } from './presets.js';

declare const __GM_PRIVATE_ASSETS__: boolean;

export type Quality = 'low' | 'high';

export interface ForestOptions {
  preset: PresetId;
  lighting: boolean;
  focus: boolean;
  quality: Quality;
}

/** The pack's tile anchor: row 208 of a 256 px tile image is the bottom corner of its 128x64 diamond. */
const TILE_ANCHOR = 208 / 256;
const TRIM = 'trim';
interface Trim {
  originX: number;
  originY: number;
}
/** Below this the sheet's feet sit on the cell centre. */
const HERO_ANCHOR = 0.8;
const HERO_SCALE = 1;
/** Sheet row 1 faces south-east, toward the camera's right like the mock. */
const HERO_ROW = 1;

const cellOf = (x: number, y: number) => {
  const [cx, cz] = worldToCell(x, y);
  return { x: cx, z: cz };
};

const campfire = (x: number, y: number): LightingLight => ({
  id: 'campfire',
  x,
  y,
  radius: 260,
  color: '#ff9a3c',
  intensity: 0.7,
  falloff: 2,
  flicker: { amount: 0.3, rate: 7, seed: 3 },
});

/**
 * The forest clearing in Phaser 4. Lighting, focus and the particle simulation come only from the core HD-2D modules;
 * particles are simulated but not drawn until the core particle backends (#1178) merge.
 */
export class Forest extends Phaser.Scene {
  lighting?: Lighting;
  focus?: Focus;
  readonly particles: ForestParticles = createForestParticles();
  private fire?: LightingLight;
  /** Trees and the cell each stands on, swayed by the same wind as the leaves. */
  private trees: { image: Phaser.GameObjects.Image; x: number; z: number }[] = [];
  private bands: Phaser.GameObjects.Container[] = [];
  readonly ready: Promise<void>;
  private markReady!: () => void;

  constructor(private options: ForestOptions) {
    super('forest');
    this.ready = new Promise((resolve) => (this.markReady = resolve));
  }

  preload(): void {
    if (!__GM_PRIVATE_ASSETS__) return;
    for (const key of TEXTURES)
      if (key === 'hero-idle')
        this.load.spritesheet(key, `assets-local/${key}.png`, { frameWidth: HERO_FRAME, frameHeight: HERO_FRAME });
      else this.load.image(key, `assets-local/${key}.png`);
  }

  create(): void {
    for (const key of TEXTURES) {
      if (this.textures.exists(key)) continue;
      const texture = this.textures.addCanvas(key, fallbackTexture(key))!;
      if (key === 'hero-idle')
        for (let i = 0; i < 15 * 8; i += 1)
          texture.add(i, 0, (i % 15) * HERO_FRAME, Math.floor(i / 15) * HERO_FRAME, HERO_FRAME, HERO_FRAME);
    }

    const images: Phaser.GameObjects.Image[] = [];
    const bands = depthBands(clearingPieces());
    const trims = new Map<string, Trim>();
    for (const band of bands) {
      const container = this.add.container(0, 0).setDepth(band.depth);
      this.bands.push(container);
      for (const piece of band.pieces) {
        const { x, y } = cellPoint(piece.cell);
        let trim = trims.get(piece.key);
        if (!trim) trims.set(piece.key, (trim = this.trim(piece.key)));
        // Flipping mirrors the trimmed frame, so the anchor column mirrors with it.
        const image = this.add
          .image(x, y + 32, piece.key, TRIM)
          .setOrigin(piece.flip ? 1 - trim.originX : trim.originX, trim.originY)
          .setScale(piece.scale)
          .setFlipX(piece.flip);
        container.add(image);
        images.push(image);
        if (piece.key.startsWith('tree-a')) this.trees.push({ image, ...cellOf(x, y) });
      }
    }

    const heroAt = cellPoint(HERO);
    this.anims.create({
      key: 'hero-idle',
      frames: this.anims.generateFrameNumbers('hero-idle', { start: HERO_ROW * 15, end: HERO_ROW * 15 + 14 }),
      frameRate: 12,
      repeat: -1,
    });
    const hero = this.add
      .sprite(heroAt.x, heroAt.y, 'hero-idle')
      .setOrigin(0.5, HERO_ANCHOR)
      .setScale(HERO_SCALE)
      .setDepth(HERO_DEPTH)
      .play('hero-idle');

    const fireAt = cellPoint(FIRE);
    this.fire = campfire(fireAt.x, fireAt.y);
    const { quality } = this.options;
    this.lighting = createLighting({ phaser: { scene: this } }, this.preset(this.options.preset), {
      quality: this.options.lighting ? quality : 'off',
      seed: 7,
    });
    const heroSheet = this.textures.get('hero-idle').getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    this.lighting.setNormalMap(hero, normalCanvas(heroSheet));
    for (const image of images) this.lighting.setNormalMap(image, 'flat');

    this.focus = createFocus(
      { phaser: { scene: this, hero } },
      { ...FOCUS, quality: this.options.focus ? quality : 'off' },
    );

    const fit = () => {
      const { width, height } = this.scale;
      this.cameras.main.setZoom(Math.max(width / 1000, height / 900)).centerOn(heroAt.x, heroAt.y - 30);
    };
    fit();
    this.scale.on('resize', fit);
    this.markReady();
  }

  update(time: number, delta: number): void {
    for (const tree of this.trees) tree.image.rotation = swayAt(this.particles.wind, tree.x, tree.z, time);
    this.particles.step(delta, time, PRESETS[this.options.preset], this.cameras.main.worldView);
    this.lighting?.update(time);
    this.focus?.update(time);
  }

  /**
   * Adds a frame cut to the texture's visible pixels: pack tiles are 256 px squares that are mostly transparent, and
   * hundreds of them overdraw the lit and filtered passes. Returns the origin that keeps the tile anchor in place.
   */
  private trim(key: string): Trim {
    const texture = this.textures.get(key);
    const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const { width, height } = source;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(source, 0, 0);
    const alpha = context.getImageData(0, 0, width, height).data;
    let [left, top, right, bottom] = [width, height, -1, -1];
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        if (alpha[(y * width + x) * 4 + 3]! > 0) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
    const w = right - left + 1;
    const h = bottom - top + 1;
    texture.add(TRIM, 0, left, top, w, h);
    return { originX: (width / 2 - left) / w, originY: (height * TILE_ANCHOR - top) / h };
  }

  private preset(id: PresetId) {
    return { ...PRESETS[id], lights: this.fire ? [this.fire] : [] };
  }

  /** The blur radius scale the focus module set on each band, back to front (0 when unblurred). */
  bandBlur(): number[] {
    return this.bands.map((band) => {
      const blur = band.filters?.internal.list.find((filter) => filter instanceof Phaser.Filters.Blur);
      return blur?.active ? Math.round(blur.x * 1000) / 1000 : 0;
    });
  }

  setPreset(id: PresetId): void {
    this.options.preset = id;
    this.lighting?.apply(this.preset(id));
  }

  setLighting(on: boolean): void {
    this.options.lighting = on;
    this.lighting?.setQuality(on ? this.options.quality : 'off');
  }

  setFocus(on: boolean): void {
    this.options.focus = on;
    this.focus?.setQuality(on ? this.options.quality : 'off');
  }
}
