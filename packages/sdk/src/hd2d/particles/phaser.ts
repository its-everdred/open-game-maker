import type Phaser from 'phaser';

import { screenOverlays } from '../overlays.js';
import type { Family, ParticleBackend } from './create.js';
import { LEAF_SIZE, leafCanvas, MOTE_SIZE, moteCanvas } from './textures.js';

// Phaser enum values, inlined so this module needs only Phaser's types (BlendModes.NORMAL / ADD, FilterMode).
const NORMAL = 0;
const ADD = 1;
const LINEAR = 0;
const NEAREST = 1;
/** Just under the lighting overlays (1e9), so leaves are shaded with the scene and motes stay above the sprites. */
const PARTICLE_DEPTH = 1e9 - 1;

let instances = 0;

/**
 * Phaser 4 particles: two layers of pooled Images (one per family) that the core pool's views position each frame,
 * so Phaser batches them and never simulates. Leaves snap to whole pixels at whole-number scales.
 */
export function createPhaserParticles({ scene, scale = 1 }: { scene: Phaser.Scene; scale?: number }): ParticleBackend {
  const id = (instances += 1);
  const keys = [`hd2d-particles-${id}-leaf`, `hd2d-particles-${id}-mote`] as const;
  for (const [index, source] of [leafCanvas(), moteCanvas()].entries()) {
    const texture = scene.textures.addCanvas(keys[index]!, source);
    if (!texture) throw new Error(`could not create particle texture ${keys[index]}`);
    texture.setFilter(index === 0 ? NEAREST : LINEAR);
  }
  const layers = [scene.add.layer(), scene.add.layer()];
  const sprites: Phaser.GameObjects.Image[][] = [[], []];
  for (const layer of layers) {
    // A full-screen pass, not a scene layer: focus must not blur it as one object.
    screenOverlays.add(layer);
    layer.setDepth(PARTICLE_DEPTH);
  }
  const camera = scene.cameras.main;

  function sprite(family: Family, slot: number): Phaser.GameObjects.Image {
    const list = sprites[family]!;
    while (list.length <= slot) {
      const image = scene.make
        .image({ key: keys[family] } as Phaser.Types.GameObjects.GameObjectConfig, false)
        .setBlendMode(family === 1 ? ADD : NORMAL);
      layers[family]!.add(image);
      list.push(image);
    }
    return list[slot]!;
  }

  return {
    begin() {},
    screen(x, y, _z, out) {
      const view = camera.worldView;
      out[0] = (x * scale - view.x) / view.width;
      out[1] = (-y * scale - view.y) / view.height;
      out[2] = scale * camera.zoom;
    },
    draw(family, slot, x, y, _z, rot, size, alpha, color) {
      const image = sprite(family, slot).setVisible(true).setAlpha(alpha).setTint(color).setRotation(rot);
      if (family === 0) {
        image.setScale(Math.round((size * scale) / LEAF_SIZE));
        image.setPosition(Math.round(x * scale), Math.round(-y * scale));
      } else {
        image.setScale((size * scale) / MOTE_SIZE);
        image.setPosition(x * scale, -y * scale);
      }
    },
    end(pixel, soft) {
      for (let slot = pixel; slot < sprites[0]!.length; slot += 1) sprites[0]![slot]!.setVisible(false);
      for (let slot = soft; slot < sprites[1]!.length; slot += 1) sprites[1]![slot]!.setVisible(false);
    },
    dispose() {
      for (const layer of layers) layer.destroy(true);
      for (const key of keys) scene.textures.remove(key);
    },
  };
}
