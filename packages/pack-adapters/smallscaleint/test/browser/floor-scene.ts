import type { AssetLoader } from '@gm/sdk/assets';
import Phaser from 'phaser';
import { createSpriteActor, IsoMap, isoToWorld } from '../../src/index.js';
import { fixtureMap4x4 } from '../fixtures/map-4x4.js';

const imageWidth = (window as unknown as { imageWidth: number }).imageWidth;
class FloorScene extends Phaser.Scene {
  async create() {
    const texture = document.createElement('canvas');
    texture.width = imageWidth;
    texture.height = 256;
    const context = texture.getContext('2d')!;
    const imageSource = (window as unknown as { imageSource?: string }).imageSource;
    if (imageSource) {
      const image = new Image();
      image.src = imageSource;
      await image.decode();
      context.drawImage(image, 0, 0);
    } else {
      context.fillStyle = '#60c060';
      for (let y = 176; y <= 240; y++) {
        const half = 2 * (32 - Math.abs(y - 208));
        context.fillRect(Math.max(0, imageWidth / 2 - half), y, Math.min(imageWidth, 2 * half + 1), 1);
      }
    }
    this.textures.addCanvas('ground-01:E', texture);
    const mixed = (window as unknown as { mixed?: boolean }).mixed;
    if (mixed) {
      const wide = document.createElement('canvas');
      wide.width = 256;
      wide.height = 256;
      wide.getContext('2d')!.drawImage(texture, 64, 0);
      this.textures.addCanvas('ground-wide:E', wide);
    }
    const source = fixtureMap4x4();
    if (mixed)
      source.tilesets[0]!.tiles.push({
        id: 8,
        properties: [
          { name: 'asset', value: 'ground-wide' },
          { name: 'rotation', value: 0 },
        ],
      });
    const map = {
      ...source,
      width: 3,
      height: 3,
      layers: source.layers.map((layer) =>
        layer.type === 'tilelayer'
          ? {
              ...layer,
              width: 3,
              height: 3,
              data: Array.from({ length: 9 }, (_, i) => (layer.name === 'floor' ? (mixed && i % 2 ? 9 : 1) : 0)),
            }
          : layer,
      ),
    };
    const actorSheet = document.createElement('canvas');
    actorSheet.width = 64;
    actorSheet.height = 64 * 8;
    const actorContext = actorSheet.getContext('2d')!;
    actorContext.fillStyle = '#ffe000';
    for (let row = 0; row < 8; row++) actorContext.fillRect(27, row * 64 + 8, 10, 24);
    this.textures.addSpriteSheet('hero:idle:shadow', actorSheet, { frameWidth: 64, frameHeight: 64 });
    const actorLoader = {
      resolve: () => ({
        url: 'https://game.test/idle.png',
        meta: {
          sprite: {
            animations: [
              { name: 'idle', fps: 1, sheets: [{ path: 'idle.png', frame_w: 64, frame_h: 64, cols: 1, rows: 8 }] },
            ],
          },
        },
      }),
    } as unknown as AssetLoader;
    const rendered = await new IsoMap(map).render(this, {} as AssetLoader);
    (window as unknown as { floor: Phaser.Tilemaps.TilemapLayer | undefined }).floor = rendered.floor;
    const actor = await createSpriteActor(this, actorLoader, 'hero', { variant: 'shadow' });
    const point = isoToWorld(1, 1);
    actor.sync({ x: 3 * 64 + point.x, y: 64 + point.y, facing: 'E', action: 'idle', t: 0 });
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      (window as unknown as { floorReady: boolean }).floorReady = true;
    });
  }
}
new Phaser.Game({
  type: (window as unknown as { useCanvas?: boolean }).useCanvas ? Phaser.CANVAS : Phaser.WEBGL,
  width: 400,
  height: 280,
  backgroundColor: '#111827',
  render: { preserveDrawingBuffer: true },
  scene: FloorScene,
});
