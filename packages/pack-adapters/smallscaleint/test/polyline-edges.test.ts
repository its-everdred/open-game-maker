import { expect, it } from 'vitest';

import { polylineEdges } from '../src/polyline-edges.js';

it('maps directed runs and turns to the cells on the requested side', () => {
  const vertices = [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 3 },
  ];
  expect(polylineEdges({ vertices, interior: 'right' })).toEqual([
    { cell: { x: 1, y: 1 }, edge: 'yMin' },
    { cell: { x: 2, y: 1 }, edge: 'yMin' },
    { cell: { x: 2, y: 1 }, edge: 'xMax' },
    { cell: { x: 2, y: 2 }, edge: 'xMax' },
  ]);
  expect(polylineEdges({ vertices: [...vertices].reverse(), interior: 'left' }).reverse()).toEqual(
    polylineEdges({ vertices, interior: 'right' }),
  );
  expect(() =>
    polylineEdges({
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      interior: 'left',
    }),
  ).toThrow('axis-aligned');
  expect(() =>
    polylineEdges({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      interior: 'left',
    }),
  ).toThrow('nonzero');
});
