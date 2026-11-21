import { describe, expect, it } from 'vitest';
import { IsoMap } from '../../pack-adapters/smallscaleint/src/map.js';
import { reviewedClone } from '../src/scene/reviewed-clone.js';

function input() {
  const tile = (name: string) => ({
    type: 'tilelayer' as const,
    name,
    width: 4,
    height: 4,
    data: Array<number>(16).fill(0),
  });
  const corners = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 3 },
    { x: 0, y: 3 },
  ];
  const candidate = { id: 'cart', model: 'offline', vector: [1, 0] };
  return {
    map: {
      orientation: 'isometric',
      width: 4,
      height: 4,
      tilewidth: 128,
      tileheight: 64,
      layers: [
        tile('floor'),
        tile('wall'),
        tile('decor'),
        tile('roof'),
        { type: 'objectgroup' as const, name: 'spawns', objects: [] },
      ],
      tilesets: [],
    },
    anchors: corners.map((point) => ({ image: point, ground: point })),
    objects: [
      {
        id: 'cart-1',
        footpoint: { x: 1, y: 2 },
        selectedAsset: 'cart',
        match: {
          query: { model: 'offline', vector: [1, 0] },
          candidates: [candidate],
          examined: 1,
          eligible: 1,
          truncated: false,
        },
        grid: { x: 1, y: 2 },
        rotation: 0 as const,
        solid: true,
        footprint: [{ x: 0, y: 0 }],
      },
    ],
    dressing: { field: { width: 1, height: 1, weights: [1] }, options: { count: 0, radius: 0, seed: 1 } },
    lockedAssets: new Set(['cart']),
    reserved: new Set<string>(),
  };
}

describe('reviewed scene export', () => {
  it('keeps fitted coordinates and exports the reviewed cell to the game map', () => {
    const result = reviewedClone(input());
    expect(result.plan.objects[0]!.position.x).toBeCloseTo(1);
    expect(result.collision).toEqual([{ x: 1, y: 2 }]);
    expect(new IsoMap(result.map).pieces('decor')).toMatchObject([{ asset: 'cart', x: 1, y: 2 }]);
  });

  it('refuses incomplete search and cells reserved by the game', () => {
    const incomplete = input();
    incomplete.objects[0]!.match.truncated = true;
    expect(() => reviewedClone(incomplete)).toThrow('visual search is incomplete');
    const blocked = input();
    blocked.reserved.add('1,2');
    expect(() => reviewedClone(blocked)).toThrow('reserved');
  });
});
