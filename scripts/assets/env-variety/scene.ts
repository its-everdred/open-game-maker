// Browser entry for lineup.mjs: renders one isometric map through the real SmallScaleInt adapter in Phaser, then
// places extra set pieces with the adapter's own projection and depth rule, the way a game scene would.
import Phaser from 'phaser';
import type { AssetLoader } from '@gm/sdk/assets';
import { IsoMap, isoToWorld, type Layer, type TiledIsoMap } from '../../../packages/pack-adapters/smallscaleint/src/index.js';

interface Resolved {
  url: string;
  meta: { sprite: { drawn_view: 'iso'; facings: Record<string, string> } };
}
interface Extra {
  asset: string;
  facing: 'N' | 'E' | 'S' | 'W';
  x: number;
  y: number;
  layer: Layer;
}
interface Spec {
  map: TiledIsoMap;
  assets: Record<string, Resolved>;
  extras: Extra[];
  jitterRoof: boolean;
  camera: { x: number; y: number; width: number; height: number };
}

const spec = (window as unknown as { spec: Spec }).spec;

class Lineup extends Phaser.Scene {
  constructor() {
    super('lineup');
  }
  async create() {
    const loader = { resolve: (id: string) => spec.assets[id] } as unknown as AssetLoader;
    const map = new IsoMap(spec.map);
    const rendered = await map.render(this, loader);
    if (spec.jitterRoof) {
      // Dusk Helm's Fields scene scatters its dry-grass roof layer the same way (src/scenes/Fields.ts).
      for (const { key, object } of rendered.sprites) {
        if (!key.startsWith('roof:')) continue;
        const [x, y] = key.slice(5).split(',').map(Number) as [number, number];
        const hash = ((x * 37 + y * 67 + x * y * 19) ^ (x * 11 + y * 23)) >>> 0;
        object.setScale(hash % 2 ? 0.6 : 0.75).setFlipX(hash % 3 === 0);
        object.x += ((hash % 5) - 2) * 4.5;
        object.y += ((hash % 3) - 1) * 2.5;
      }
    }
    const keys = new Set<string>();
    for (const extra of spec.extras) {
      const key = `${extra.asset}:${extra.facing}`;
      if (this.textures.exists(key) || keys.has(key)) continue;
      const resolved = spec.assets[extra.asset]!;
      this.load.image(key, new URL(resolved.meta.sprite.facings[extra.facing]!, resolved.url).toString());
      keys.add(key);
    }
    await new Promise<void>((resolve) => {
      this.load.once('complete', () => resolve());
      this.load.start();
      if (keys.size === 0) resolve();
    });
    for (const extra of spec.extras) {
      const key = `${extra.asset}:${extra.facing}`;
      const point = isoToWorld(extra.x, extra.y);
      this.add
        .image(map.height * 64 + point.x, 64 + point.y, key)
        .setOrigin(0.5, 208 / this.textures.get(key).getSourceImage().height)
        .setDepth(map.depthOf(extra.x, extra.y, extra.layer));
    }
    const camera = this.cameras.main;
    camera.setZoom(Math.min(this.scale.width / spec.camera.width, this.scale.height / spec.camera.height));
    camera.centerOn(spec.camera.x, spec.camera.y);
    (window as unknown as { ready: boolean }).ready = true;
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#1b2418',
  pixelArt: true,
  scene: Lineup,
});
