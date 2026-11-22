import { expect, it } from 'vitest';

import { openingVertices } from '../src/openings.js';

it('returns the grid vertices on either side of an exterior opening', () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  expect(openingVertices(cells, [{ cell: cells[0]!, edge: 'yMin' }])).toEqual([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]);
  expect(
    openingVertices(cells, [
      { cell: cells[0]!, edge: 'yMin' },
      { cell: cells[1]!, edge: 'yMin' },
      { cell: cells[0]!, edge: 'yMin' },
    ]),
  ).toEqual([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ]);
  expect(() => openingVertices(cells, [{ cell: cells[0]!, edge: 'xMax' }])).toThrow('exterior');
});
