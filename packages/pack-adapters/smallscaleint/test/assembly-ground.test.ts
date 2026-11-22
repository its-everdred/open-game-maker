import { expect, it } from 'vitest';

import { naturalScatter, pavingPath } from '../src/assembly-ground.js';
import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';

it('builds a connected path and reserved-cell-safe dressing consumable by IsoMap', () => {
  const region = Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) }));
  const path = pavingPath({ x: 0, y: 2 }, { x: 4, y: 2 }, { asset: 'paving', facing: 'E', walkable: region });
  const reserved = path.map(({ cell }) => cell);
  const decor = naturalScatter(region, [{ asset: 'grass', facing: 'N', solid: false }], 1, {
    seed: 5,
    avoid: reserved,
    boundaries: [],
    boundaryDensity: 0,
  });
  const styleWithExtraFields = {
    asset: 'grass',
    facing: 'E' as const,
    solid: false,
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
