import type { AssetLoader } from '@gm/sdk/assets';
import Phaser from 'phaser';

import { IsoMap, type TileFacing } from '../../src/index.js';
import { fixtureMap4x4 } from '../fixtures/map-4x4.js';

const COLORS: Record<TileFacing, [number, number, number]> = {
  E: [225, 74, 72],
  N: [69, 177, 98],
  W: [67, 125, 220],
  S: [230, 176, 54],
};

function pieceTexture(color: [number, number, number], floor = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  const css = `rgb(${color.join(',')})`;
  if (!floor) {
    g.fillStyle = css;
    g.fillRect(72, 30, 112, 162);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(112, 54, 32, 72);
  }
  g.fillStyle = floor ? '#536d42' : css;
  g.beginPath();
  g.moveTo(128, 176);
  g.lineTo(192, 208);
  g.lineTo(128, 240);
  g.lineTo(64, 208);
  g.closePath();
  g.fill();
  return canvas;
}

function countColor(data: Uint8ClampedArray, target: [number, number, number]): number {
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i]! - target[0]) < 8 &&
      Math.abs(data[i + 1]! - target[1]) < 8 &&
      Math.abs(data[i + 2]! - target[2]) < 8
    ) {
      count += 1;
    }
  }
  return count;
}

class Fixture extends Phaser.Scene {
  create() {
    this.textures.addCanvas('ground-01:E', pieceTexture([83, 109, 66], true));
    for (const [facing, color] of Object.entries(COLORS) as [TileFacing, [number, number, number]][]) {
      this.textures.addCanvas(`chest:${facing}`, pieceTexture(color));
    }
    this.textures.addCanvas('wall-01:E', pieceTexture([121, 126, 139]));
    this.textures.addCanvas('door-01:N', pieceTexture([133, 86, 54]));
    this.textures.addCanvas('roof-01:S', pieceTexture([105, 68, 135]));

    const loader = { resolve: () => void 0 } as unknown as AssetLoader;
    void new IsoMap(fixtureMap4x4()).render(this, loader).then(() => {
      this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
        this.game.renderer.snapshot((image) => {
          const snapshot = image as HTMLImageElement;
          const canvas = document.createElement('canvas');
          canvas.width = snapshot.width;
          canvas.height = snapshot.height;
          const g = canvas.getContext('2d')!;
          g.drawImage(snapshot, 0, 0);
          const { data } = g.getImageData(0, 0, snapshot.width, snapshot.height);
          let nonBlank = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i]! > 30 || data[i + 1]! > 40 || data[i + 2]! > 60) nonBlank += 1;
          }
          (window as unknown as { fixture: unknown }).fixture = {
            renderer: this.game.renderer.type,
            size: [snapshot.width, snapshot.height],
            nonBlank,
            facingPixels: Object.fromEntries(
              Object.entries(COLORS).map(([facing, color]) => [facing, countColor(data, color)]),
            ),
          };
        });
      });
    });
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  width: 1024,
  height: 640,
  backgroundColor: '#111827',
  scene: Fixture,
});
