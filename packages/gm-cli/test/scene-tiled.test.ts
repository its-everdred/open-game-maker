import { describe, expect, it } from 'vitest';
import { IsoMap } from '../../pack-adapters/smallscaleint/src/map.js';
import { sceneDecorLayer } from '../src/scene/tiled.js';

const object = { id: 'cart', position: { x: 1, y: 2 }, selectedAsset: 'cart-asset', matches: [] };
const placement = { object, rotation: 90 as const, solid: true };

describe('scene decor layer', () => {
  it('is consumed by the SmallScaleInt Tiled adapter with asset, facing and collision', () => {
    const { layer, tileset } = sceneDecorLayer(4, 4, 1, [placement], new Set(['cart-asset']), new Set());
    const map = new IsoMap({
      orientation: 'isometric',
      width: 4,
      height: 4,
      tilewidth: 128,
      tileheight: 64,
      layers: [
        ...['floor', 'wall', 'roof'].map((name) => ({
          type: 'tilelayer',
          name,
          width: 4,
          height: 4,
          data: Array<number>(16).fill(0),
        })),
        layer,
        { type: 'objectgroup', name: 'spawns', objects: [] },
      ],
      tilesets: [tileset],
    });
    expect(map.pieces()).toMatchObject([{ x: 1, y: 2, asset: 'cart-asset', facing: 'N', solid: true }]);
  });

  it('refuses unlocked assets, reserved cells and multiple objects in a cell', () => {
    expect(() => sceneDecorLayer(4, 4, 1, [placement], new Set(), new Set())).toThrow('not locked');
    expect(() => sceneDecorLayer(4, 4, 1, [placement], new Set(['cart-asset']), new Set(['1,2']))).toThrow('reserved');
    expect(() => sceneDecorLayer(4, 4, 1, [placement, placement], new Set(['cart-asset']), new Set())).toThrow(
      'share a cell',
    );
  });

  it('requires explicit grid positions instead of silently rounding a registered footpoint', () => {
    const fractional = { ...placement, object: { ...object, position: { x: 1.2, y: 2 } } };
    expect(() => sceneDecorLayer(4, 4, 1, [fractional], new Set(['cart-asset']), new Set())).toThrow('tile grid');
  });
});
