import { expect, it } from 'vitest';

import { boundary } from '../src/boundary.js';

it('extracts the exterior of adjoining cells, with one opening and no duplicate shared edge', () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  const gate = { cell: cells[0]!, edge: 'yMin' as const };
  const edges = boundary([...cells, cells[0]!], [gate]);
  expect(edges).toHaveLength(5);
  expect(edges).not.toContainEqual(gate);
  expect(edges).not.toContainEqual({ cell: cells[0], edge: 'xMax' });
  expect(edges).not.toContainEqual({ cell: cells[1], edge: 'xMin' });
  expect(edges).toContainEqual({ cell: cells[1], edge: 'yMin' });
});
