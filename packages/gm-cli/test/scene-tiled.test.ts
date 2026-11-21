import { describe, expect, it } from 'vitest';
import { IsoMap } from '../../pack-adapters/smallscaleint/src/map.js';
import { sceneDecorLayer } from '../src/scene/tiled.js';
import { buildScenePlan } from '../src/scene/plan.js';
import { sceneObjectFromMatch } from '../src/scene/worker-result.js';

const object = { id: 'cart', position: { x: 1, y: 2 }, selectedAsset: 'cart-asset', matches: [] };
const placement = { object, rotation: 90 as const, solid: true, footprint: [{ x: 0, y: 0 }] };

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

  it('checks every reviewed footprint cell against reservations and other objects', () => {
    const wide = {
      ...placement,
      footprint: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    expect(() => sceneDecorLayer(4, 4, 1, [wide], new Set(['cart-asset']), new Set(['2,2']))).toThrow('reserved');
    const other = { ...placement, object: { ...object, position: { x: 2, y: 2 } } };
    expect(() => sceneDecorLayer(4, 4, 1, [wide, other], new Set(['cart-asset']), new Set())).toThrow('share a cell');
    expect(() =>
      sceneDecorLayer(4, 4, 1, [{ ...wide, footprint: [{ x: 1, y: 0 }] }], new Set(['cart-asset']), new Set()),
    ).toThrow('omits its anchor');
    expect(sceneDecorLayer(4, 4, 1, [wide], new Set(['cart-asset']), new Set()).occupied).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(sceneDecorLayer(4, 4, 1, [wide], new Set(['cart-asset']), new Set()).collision).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(sceneDecorLayer(4, 4, 1, [{ ...wide, solid: false }], new Set(['cart-asset']), new Set()).collision).toEqual(
      [],
    );
  });

  it('carries a complete worker match through registration into adapter-readable map data', () => {
    const candidate = { id: 'cart-asset', model: 'offline', vector: [1, 0] };
    const matched = sceneObjectFromMatch(
      { id: 'cart', footpoint: { x: 1, y: 2 }, selectedAsset: 'cart-asset' },
      {
        query: { model: 'offline', vector: [1, 0] },
        candidates: [candidate],
        examined: 1,
        eligible: 1,
        truncated: false,
      },
    );
    const corners = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ];
    const plan = buildScenePlan({
      anchors: corners.map((point) => ({ image: point, ground: point })),
      objects: [matched],
      dressing: { field: { width: 1, height: 1, weights: [1] }, options: { count: 0, radius: 0, seed: 1 } },
    });
    // Grid review is explicit: numerical fitting may introduce subpixel error.
    const fitted = plan.objects[0]!;
    expect(fitted.position.x).toBeCloseTo(1);
    expect(fitted.position.y).toBeCloseTo(2);
    const reviewed = { ...fitted, position: { x: 1, y: 2 } };
    const { layer, tileset } = sceneDecorLayer(
      4,
      4,
      1,
      [{ object: reviewed, rotation: 0, solid: true, footprint: [{ x: 0, y: 0 }] }],
      new Set(['cart-asset']),
      new Set(),
    );
    expect(layer.data[9]).toBe(1);
    expect(tileset.tiles[0]!.properties).toContainEqual({ name: 'asset', value: 'cart-asset' });
  });
});
