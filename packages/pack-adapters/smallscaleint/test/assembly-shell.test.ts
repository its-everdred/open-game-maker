import { expect, it } from 'vitest';

import { assemblyMap } from '../src/assembly-map.js';
import { stoneShell } from '../src/assembly-shell.js';
import { IsoMap } from '../src/map.js';

it('preserves stone shell edges and a traversable inspected doorway', () => {
  const cells = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  const door = { cell: { x: 1, y: 1 }, edge: 'yMax' as const };
  const shell = stoneShell(cells, door, [{ x: 1, y: 2 }]);
  const map = new IsoMap(assemblyMap(3, 3, shell.placements));
  expect(map.pieces('wall')).toHaveLength(11);
  expect(
    map
      .pieces('wall')
      .filter(({ x, y }) => x === 1 && y === 1)
      .map(({ facing }) => facing),
  ).toEqual(['S', 'S']);
  expect(map.collisionGrid()[1]![1]).toBe(false);
  expect(shell.entry).toEqual({ x: 1, y: 2 });
  expect(() => stoneShell(cells, { cell: { x: 1, y: 0 }, edge: 'yMin' }, [{ x: 1, y: -1 }])).toThrow('only inspected');
  expect(() => stoneShell(cells, { cell: { x: 0, y: 1 }, edge: 'yMax' }, [{ x: 0, y: 2 }])).toThrow('another wall');
});
