import { expect, it } from 'vitest';

import { naturalScatter, pavingPath, steppingStonePath, variedSteppingStonePath } from '../src/assembly-ground.js';
import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';

it('builds a connected path and reserved-cell-safe dressing consumable by IsoMap', () => {
  const region = Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) }));
  const path = pavingPath({ x: 0, y: 2 }, { x: 4, y: 2 }, { asset: 'paving', facing: 'E', walkable: region });
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
  const map = new IsoMap(assemblyMap(5, 5, [...path, ...decor]));
  expect(map.pieces('floor')).toHaveLength(5);
  expect(map.pieces('decor').length).toBeGreaterThan(0);
  expect(map.pieces('decor').every(({ x, y }) => !reserved.some((cell) => cell.x === x && cell.y === y))).toBe(true);
  expect(map.pieces('floor').every(({ solid }) => !solid)).toBe(true);
});

it('keeps underlying ground when stepping-stone images are transparent', () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  const ground = cells.map((cell) => ({
    cell,
    layer: 'floor' as const,
    asset: 'grass',
    facing: 'E' as const,
    solid: false,
  }));
  const stones = steppingStonePath(cells[0]!, cells[1]!, { asset: 'stones', facing: 'E', walkable: cells });
  const map = new IsoMap(assemblyMap(2, 1, [...ground, ...stones]));
  expect(map.pieces('floor').map(({ asset }) => asset)).toEqual(['grass', 'grass']);
  expect(map.pieces('decor').map(({ asset }) => asset)).toEqual(['stones', 'stones']);
  expect(map.collisionGrid()).toEqual([[false, false]]);
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
