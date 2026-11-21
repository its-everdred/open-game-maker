import { expect, it } from 'vitest';
import { reviewedBriefClone } from '../src/scene/brief-clone.js';

function input() {
  const points = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 3 },
    { x: 0, y: 3 },
  ];
  return {
    brief: {
      image: { width: 4, height: 4 },
      story: 'A trader arrives.',
      mood: 'Calm',
      light: 'Dusk',
      focalRegion: 'cart',
      regions: [{ id: 'cart', label: 'Cart', layer: 'prop', bounds: { x: 1, y: 1, width: 2, height: 2 } }],
    },
    map: {
      width: 4,
      height: 4,
      layers: [{ type: 'tilelayer' as const, name: 'decor', width: 4, height: 4, data: Array<number>(16).fill(0) }],
      tilesets: [],
    },
    anchors: points.map((point) => ({ image: point, ground: point })),
    objects: [
      {
        id: 'cart',
        footpoint: { x: 2, y: 3 },
        selectedAsset: 'cart',
        grid: { x: 1, y: 2 },
        rotation: 0 as const,
        solid: true,
        footprint: [{ x: 0, y: 0 }],
        match: {
          query: { model: 'offline', vector: [1, 0] },
          candidates: [{ id: 'cart', model: 'offline', vector: [1, 0] }],
          examined: 1,
          eligible: 1,
          truncated: false,
        },
      },
    ],
    dressing: { field: { width: 1, height: 1, weights: [1] }, options: { count: 0, radius: 0, seed: 1 } },
    lockedAssets: new Set(['cart']),
    reserved: new Set<string>(),
  };
}

it('keeps the reviewed brief and exports its matched object', () => {
  const result = reviewedBriefClone(input());
  expect(result.brief.focalRegion).toBe('cart');
  expect(result.collision).toEqual([{ x: 1, y: 2 }]);
});

it('refuses unmatched regions and footpoints outside the reviewed region', () => {
  const unknown = input();
  unknown.objects[0]!.id = 'other';
  expect(() => reviewedBriefClone(unknown)).toThrow('has no brief region');
  const outside = input();
  outside.objects[0]!.footpoint.x = 0;
  expect(() => reviewedBriefClone(outside)).toThrow('footpoint is outside');
});

it('checks reviewed collision against an authored route when provided', () => {
  const data = input();
  const routeChecks = {
    grid: { width: 4, height: 4, cells: Array<boolean>(16).fill(true) },
    routes: [
      {
        id: 'entrance',
        waypoints: [
          { x: 0, y: 2 },
          { x: 1, y: 2 },
          { x: 2, y: 2 },
        ],
      },
    ],
  };
  expect(() => reviewedBriefClone({ ...data, routeChecks })).toThrow('blocked waypoint');
  expect(() =>
    reviewedBriefClone({ ...data, routeChecks: { ...routeChecks, grid: { ...routeChecks.grid, width: 3 } } }),
  ).toThrow('does not match');
});
