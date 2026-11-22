import { expect, it } from 'vitest';

import { provisionalStoneBuilding } from '../src/assembly-building.js';
import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';

it('assembles a roof-covered shell and an unblocked exterior doorway', () => {
  const footprint = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  const result = provisionalStoneBuilding(footprint, { cell: { x: 1, y: 1 }, edge: 'yMax' }, [{ x: 1, y: 2 }]);
  const map = new IsoMap(assemblyMap(3, 3, result.placements));
  for (const { x, y } of footprint) expect(map.roofTilesAbove(x, y)).toHaveLength(1);
  expect(map.collisionGrid()[1]![1]).toBe(false);
  expect(result.entry).toEqual({ x: 1, y: 2 });
});
