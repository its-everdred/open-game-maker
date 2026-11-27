import type { AssetLoader } from '@gm/sdk/assets';
import Phaser from 'phaser';

import { assemblyMap } from '../../src/assembly-map.js';
import { IsoMap } from '../../src/map.js';

class Fixture extends Phaser.Scene {
  create() {
    const texture = document.createElement('canvas');
    texture.width = texture.height = 256;
    const context = texture.getContext('2d')!;
    context.fillStyle = '#ffcc00';
    context.fillRect(80, 100, 96, 96);
    for (const key of ['fence:W', 'fence:S', 'roof:N']) this.textures.addCanvas(key, texture);
    const cell = { x: 0, y: 0 };
    const map = new IsoMap(
      assemblyMap(1, 1, [
        { cell, layer: 'wall', asset: 'fence', facing: 'W', solid: true, scale: 0.4 },
        { cell, layer: 'wall', asset: 'fence', facing: 'S', solid: true },
        { cell, layer: 'roof', asset: 'roof', facing: 'N', solid: false, elevation: 1.75 },
      ]),
    );
    void map.render(this, {} as AssetLoader).then(({ sprites }) => {
      const before = sprites.map(({ key, object }) => ({
        key,
        x: object.x,
        y: object.y,
        scale: object.scaleX,
        visible: object.visible,
      }));
      map.sync({ [sprites[0]!.key]: { visible: false } });
      (window as unknown as { overlap: unknown }).overlap = {
        before,
        after: sprites.map(({ object }) => object.visible),
        collision: map.collisionGrid(),
        renderer: this.game.renderer.type,
      };
    });
  }
}
new Phaser.Game({ type: Phaser.WEBGL, width: 512, height: 512, scene: Fixture });
