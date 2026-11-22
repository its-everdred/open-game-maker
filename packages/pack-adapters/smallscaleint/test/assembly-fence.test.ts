import { expect, it } from 'vitest';

import { fenceRun } from '../src/assembly-fence.js';
import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';

it('preserves every fence edge including corners and opens exactly the selected gate', () => {
  const cells = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  const closed = fenceRun(cells, []);
  const gate = fenceRun(cells, [{ cell: { x: 1, y: 1 }, edge: 'yMax' }]);
  expect(closed.placements).toHaveLength(10);
  expect(gate.placements).toHaveLength(9);
  expect(gate.postVertices).toEqual([
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ]);
  const map = new IsoMap(assemblyMap(3, 2, gate.placements));
  expect(map.pieces('wall')).toHaveLength(9);
  expect(
    map
      .pieces('wall')
      .filter(({ x, y }) => x === 0 && y === 0)
      .map(({ facing }) => facing)
      .sort(),
  ).toEqual(['S', 'W']);
  expect(map.pieces('wall').some(({ x, y, facing }) => x === 1 && y === 1 && facing === 'E')).toBe(false);
});
