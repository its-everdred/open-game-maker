import { expect, it } from 'vitest';

import { provisionalStoneBuilding } from '../src/assembly-building.js';
import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';
import { building } from '../src/assemblers.js';

it('assembles a roof-covered shell and an unblocked exterior doorway', () => {
  const footprint = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  const result = provisionalStoneBuilding(footprint, { cell: { x: 1, y: 1 }, edge: 'yMax' }, [{ x: 1, y: 2 }]);
  const map = new IsoMap(assemblyMap(3, 3, result.placements));
  for (const { x, y } of footprint) expect(map.roofTilesAbove(x, y)).toHaveLength(1);
  expect(map.collisionGrid()[1]![1]).toBe(false);
  expect(result.entry).toEqual({ x: 1, y: 2 });
});

it('assembles a timber shell with a clear doorway and depth-ordered thatched roof', () => {
  const footprint = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  const result = building(footprint, 'timber', { cell: { x: 1, y: 1 }, edge: 'yMax' }, [{ x: 1, y: 2 }]);
  const map = new IsoMap(assemblyMap(3, 3, result.placements));
  expect(result.entry).toEqual({ x: 1, y: 2 });
  expect(map.collisionGrid()[1]![1]).toBe(false);
  expect(footprint.every(({ x, y }) => map.roofTilesAbove(x, y).length === 1)).toBe(true);
  const walls = map.pieces('wall').filter((piece) => piece.asset.includes('wall-c1'));
  expect(walls).toHaveLength(9);
  expect(map.collisionGrid()[0]![0]).toBe(true);
  expect(walls.every((piece) => piece.depthOffset === (piece.facing === 'E' || piece.facing === 'S' ? 16 : -16))).toBe(
    true,
  );
  expect(map.pieces('roof').every((piece) => piece.asset.includes('roof-a1') && piece.depthOffset === 64)).toBe(true);
  expect(
    map
      .pieces('wall')
      .filter((piece) => piece.x === 1 && piece.y === 1)
      .map((piece) => piece.asset.split('/').pop()),
  ).toEqual(['wall-c6@2026-11-01', 'door-a1@2026-11-01']);
  expect(() => building(footprint, 'timber', { cell: { x: 1, y: 0 }, edge: 'yMin' }, [{ x: 1, y: -1 }])).toThrow(
    'yMax',
  );
});
