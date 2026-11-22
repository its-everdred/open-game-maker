import { expect, it } from 'vitest';

import { naturalScatter, variedSteppingStonePath } from '../src/assembly-ground.js';
import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';

it('builds a connected path and reserved-cell-safe dressing consumable by IsoMap', () => {
  const region = Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) }));
  const ground = region.map((cell) => ({
    cell,
    layer: 'floor' as const,
    asset: 'grass',
    facing: 'E' as const,
    solid: false,
  }));
  const path = variedSteppingStonePath(
    { x: 0, y: 2 },
    { x: 4, y: 2 },
    {
      walkable: region,
      palette: [{ asset: 'stones', facing: 'E' }],
      seed: 2,
    },
  );
  const reserved = path.map(({ cell }) => cell);
  const decor = naturalScatter(
    region,
    [{ asset: 'grass', facing: 'N', solid: false, footprint: [{ x: 0, y: 0 }] }],
    1,
    {
      seed: 5,
      avoid: reserved,
      boundaries: [],
      boundaryDensity: 0,
    },
  );
  const styleWithExtraFields = {
    asset: 'grass',
    facing: 'E' as const,
    solid: false,
    footprint: [{ x: 0, y: 0 }],
    cell: { x: 0, y: 2 },
    layer: 'wall',
  };
  const extraFields = naturalScatter([{ x: 1, y: 1 }], [styleWithExtraFields], 1, {
    seed: 5,
    avoid: [],
    boundaries: [{ x: 1, y: 1 }],
    boundaryDensity: 1,
  });
  expect(extraFields[0]).toMatchObject({ cell: { x: 1, y: 1 }, layer: 'decor' });
  const map = new IsoMap(assemblyMap(5, 5, [...ground, ...path, ...decor]));
  expect(map.pieces('floor')).toHaveLength(25);
  // Transparent stepping stones sit above the ground instead of replacing it.
  expect(map.pieces('decor').filter(({ asset }) => asset === 'stones')).toHaveLength(5);
  expect(map.pieces('decor').length).toBeGreaterThan(0);
  expect(
    map
      .pieces('decor')
      .filter(({ asset }) => asset === 'grass')
      .every(({ x, y }) => !reserved.some((cell) => cell.x === x && cell.y === y)),
  ).toBe(true);
  expect(map.pieces('floor').every(({ solid }) => !solid)).toBe(true);
});

it('varies stepping stones reproducibly while retaining every route cell', () => {
  const route = Array.from({ length: 12 }, (_, x) => ({ x, y: 0 }));
  const style = {
    walkable: route,
    palette: [
      { asset: 'stones', facing: 'E' as const },
      { asset: 'stones', facing: 'N' as const },
      { asset: 'stones', facing: 'S' as const },
      { asset: 'stones', facing: 'W' as const },
    ],
    seed: 31,
  };
  const stones = variedSteppingStonePath(route[0]!, route.at(-1)!, style);
  expect(stones).toHaveLength(route.length);
  expect(stones.map(({ cell }) => cell)).toEqual(route);
  expect(new Set(stones.map(({ facing }) => facing)).size).toBeGreaterThan(1);
  expect(variedSteppingStonePath(route[0]!, route.at(-1)!, style)).toEqual(stones);
  expect(stones.every(({ solid, layer }) => !solid && layer === 'decor')).toBe(true);
});

it('keeps every cell of a large prop clear of reserved cells and other props', () => {
  const tree = {
    asset: 'tree',
    facing: 'E' as const,
    solid: true,
    footprint: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
  };
  const cells = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ];
  const rules = { seed: 1, avoid: [{ x: 1, y: 0 }], boundaries: cells, boundaryDensity: 1 };
  const result = naturalScatter(cells, [tree], 1, rules);
  expect(result.map(({ cell }) => cell)).toEqual([{ x: 2, y: 0 }]);
  const neighbors = [
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ];
  expect(
    naturalScatter(neighbors, [tree], 1, { ...rules, avoid: [], boundaries: neighbors }).map(({ cell }) => cell),
  ).toEqual([{ x: 2, y: 0 }]);
  expect(() => naturalScatter(cells, [{ ...tree, footprint: [] }], 1, rules)).toThrow('footprint');
});

it('makes solid dressing block movement so a grave is not walk-through scenery', () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  const rules = { seed: 3, avoid: [], boundaries: cells, boundaryDensity: 1 };
  const graves = naturalScatter(
    cells,
    [{ asset: 'grave', facing: 'S', solid: true, footprint: [{ x: 0, y: 0 }] }],
    1,
    rules,
  );
  const grass = naturalScatter(
    cells,
    [{ asset: 'grass', facing: 'S', solid: false, footprint: [{ x: 0, y: 0 }] }],
    1,
    rules,
  );
  expect(graves).toHaveLength(2);
  expect(new IsoMap(assemblyMap(2, 1, graves)).collisionGrid()).toEqual([[true, true]]);
  expect(new IsoMap(assemblyMap(2, 1, grass)).collisionGrid()).toEqual([[false, false]]);
});
