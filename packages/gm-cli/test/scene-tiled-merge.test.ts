import { describe, expect, it } from 'vitest';
import { IsoMap } from '../../pack-adapters/smallscaleint/src/map.js';
import { mergeSceneDecor, type SceneTiledMap } from '../src/scene/tiled-merge.js';

const object = { id: 'cart', position: { x: 1, y: 1 }, selectedAsset: 'cart', matches: [] };
const placement = {
  object,
  rotation: 0 as const,
  solid: true,
  footprint: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
};

function gameMap() {
  const layer = (name: string, data = [0, 0, 0, 0, 0, 0]) => ({
    type: 'tilelayer' as const,
    name,
    width: 3,
    height: 2,
    data,
  });
  return {
    orientation: 'isometric',
    width: 3,
    height: 2,
    tilewidth: 128,
    tileheight: 64,
    layers: [
      layer('floor', [1, 1, 1, 1, 1, 1]),
      layer('wall'),
      layer('decor', [2, 0, 0, 0, 0, 0]),
      layer('roof'),
      { type: 'objectgroup' as const, name: 'spawns', objects: [] },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'game',
        tiles: [
          { id: 0, properties: [{ name: 'asset', value: 'ground' }] },
          { id: 1, properties: [{ name: 'asset', value: 'existing' }] },
        ],
      },
    ],
  } satisfies SceneTiledMap;
}

describe('merge scene decor', () => {
  it('preserves existing tiles and yields data consumed by the real map reader', () => {
    const input = gameMap();
    const before = structuredClone(input);
    const result = mergeSceneDecor(input, [placement], new Set(['cart']), new Set());
    const pieces = new IsoMap(result.map).pieces('decor');
    expect(pieces).toMatchObject([{ asset: 'existing' }, { asset: 'cart', x: 1, y: 1, solid: true }]);
    expect(result.collision).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(input).toEqual(before);
  });

  it('rejects existing decor in any part of the new footprint', () => {
    const game = gameMap();
    const atTop = { ...placement, object: { ...object, position: { x: 0, y: 0 } } };
    expect(() => mergeSceneDecor(game, [atTop], new Set(['cart']), new Set())).toThrow('reserved');
    const decor = game.layers.find((layer) => layer.name === 'decor');
    if (decor?.type !== 'tilelayer') throw new Error('fixture missing decor');
    decor.data[5] = 2;
    expect(() => mergeSceneDecor(game, [placement], new Set(['cart']), new Set())).toThrow('reserved');
  });
});
