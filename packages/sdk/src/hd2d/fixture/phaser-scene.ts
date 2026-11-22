import Phaser from 'phaser';
import type { TestArt } from './testart.js';

export type ClearingScene = Phaser.Scene & { created: Promise<void>; step(ms: number): void };

/** The forest clearing in Phaser: the same layout as the three.js scene. */
export function createPhaserScene(art: TestArt, seed: number): ClearingScene {
  let markCreated!: () => void;
  const created = new Promise<void>((resolve) => (markCreated = resolve));

  class Clearing extends Phaser.Scene {
    readonly created = created;
    private sway?: Phaser.GameObjects.Image;
    private hero?: Phaser.GameObjects.Image;

    constructor() {
      super('clearing');
    }

    create(): void {
      for (const key of ['tree', 'trunk', 'canopy', 'hero', 'leaves'] as const) this.textures.addCanvas(key, art[key]);
      this.add.rectangle(320, 70, 640, 140, 0x22343a);
      for (let i = 0; i < 10; i += 1)
        this.add
          .image(32 + i * 66, 92 + ((i * 13 + seed) % 12), 'tree')
          .setScale(0.6)
          .setTint(0x4b6a72);
      this.add.rectangle(320, 268, 640, 184, 0x416345);
      this.add.rectangle(320, 302, 460, 10, 0xb58b50);
      for (let i = 0; i < 5; i += 1) {
        const x = 64 + i * 128;
        const y = 150 + ((i * 37 + seed) % 30);
        this.add.image(x, y, 'trunk').setDepth(10 + y / 10);
        const canopy = this.add.image(x, y - 60, 'canopy').setDepth(10.5 + y / 10);
        if (i === 2) this.sway = canopy;
      }
      this.hero = this.add.image(320, 252, 'hero').setScale(2).setDepth(50);
      for (let i = 0; i < 8; i += 1)
        this.add
          .image(40 + i * 80, 350, 'leaves')
          .setScale(1.5)
          .setTint(0x2c4a3a)
          .setDepth(60);
      markCreated();
    }

    step(ms: number): void {
      if (this.sway) this.sway.rotation = -Math.sin(ms / 620) * 0.05;
      this.hero?.setY(252 + Math.round(Math.sin(ms / 340) * 2));
    }
  }
  return new Clearing() as ClearingScene;
}
