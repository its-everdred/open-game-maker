import type { AssetLoader } from '@gm/sdk/assets';
import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';

import { TerrainMap, renderTerrain, type TerrainSpec } from '../src/index.js';

/** Just enough Phaser for renderTerrain: loads succeed at once and images record their depth. */
function fakeScene() {
  const loaded = new Set<string>();
  const queued: string[] = [];
  const images: { texture: string; depth: number; destroyed: boolean }[] = [];
  const once = new Map<string, () => void>();
  const scene = {
    textures: {
      exists: (key: string) => loaded.has(key),
      get: () => ({ getSourceImage: () => ({ width: 256, height: 256 }) }),
    },
    load: {
      spritesheet: (key: string) => queued.push(key),
      image: (key: string) => queued.push(key),
      on() {},
      off() {},
      once: (event: string, callback: () => void) => once.set(event, callback),
      start() {
        for (const key of queued.splice(0)) loaded.add(key);
        once.get('complete')?.();
      },
    },
    add: {
      image: (_x: number, _y: number, texture: string) => {
        const image = {
          texture,
          depth: 0,
          destroyed: false,
          setOrigin: () => image,
          setDepth: (depth: number) => ((image.depth = depth), image),
          destroy: () => void (image.destroyed = true),
        };
        images.push(image);
        return image;
      },
    },
  };
  return { scene: scene as unknown as Phaser.Scene, images, queued, loaded };
}

const loader = (decalFacings: boolean) =>
  ({
    resolve: (id: string) => ({
      url: `https://game.test/${id}.png`,
      meta: decalFacings ? { sprite: { facings: { E: 'e.png', N: 'n.png', W: 'w.png', S: 's.png' } } } : undefined,
    }),
  }) as unknown as AssetLoader;

const terrains = (decalChance: number): TerrainSpec[] => [
  { id: 'dirt', sheet: 't3:test/dirt' },
  { id: 'grass', sheet: 't3:test/grass', decals: ['t3:test/tuft'], decalChance },
];

describe('renderTerrain', () => {
  it('does not load decals whose chance is 0, so an unavailable one cannot stop the ground drawing', async () => {
    const { scene, loaded } = fakeScene();
    const map = new TerrainMap({ width: 3, height: 3, terrains: terrains(0), cells: Array(9).fill(1), seed: 1 });
    await expect(renderTerrain(scene, loader(false), map)).resolves.toBeDefined();
    expect([...loaded].some((key) => key.startsWith('t3:test/tuft'))).toBe(false);
  });

  it('orders decals by row, so a redraw never puts a farther decal in front of a nearer one', async () => {
    const { scene, images } = fakeScene();
    const map = new TerrainMap({ width: 7, height: 7, terrains: terrains(1), cells: Array(49).fill(1), seed: 1 });
    const rendered = await renderTerrain(scene, loader(true), map);
    // Paint and undo a cell: the cells around it are destroyed and drawn again, after the far ones.
    rendered.refresh(map.paint([{ x: 3, y: 3 }], 0)!);
    rendered.refresh(map.undo()!);
    const decals = images.filter((image) => !image.destroyed && image.texture.startsWith('t3:test/tuft'));
    expect(decals.length).toBe(49);
    const depths = new Set(decals.map((image) => image.depth));
    expect(depths.size).toBe(13); // one depth per row x + y = 0..12
    for (const depth of depths) {
      expect(depth).toBeLessThan(0); // below every IsoMap piece
      expect(depth).toBeGreaterThan(-0.9 + 0.01); // above the ground pieces
    }
  });
});
