import { expect, it } from 'vitest';
import { fenceGateLayout, fenceLayout } from '../src/fence-layout.js';

it('puts neighbouring fence pieces end to end and leaves the gate open', () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ];
  const gate = { cell: { x: 1, y: 1 }, edge: 'yMax' as const };
  const edges = fenceLayout(cells, [gate]);
  expect(fenceGateLayout(cells, [gate]).posts).toEqual([
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ]);
  expect(edges).toHaveLength(9);
  expect(edges).not.toContainEqual(expect.objectContaining(gate));
  expect(edges.filter((piece) => piece.edge === 'yMin').map(({ facing }) => facing)).toEqual(['W', 'W', 'W']);
  expect(edges.filter((piece) => piece.edge === 'xMin').map(({ facing }) => facing)).toEqual(['S', 'S']);
  expect(edges.filter((piece) => piece.edge === 'xMax').map(({ facing }) => facing)).toEqual(['N', 'N']);
  expect(edges.filter((piece) => piece.edge === 'yMax').map(({ facing }) => facing)).toEqual(['E', 'E']);
});
