import { expect, it } from 'vitest';

import { edgeRun } from '../src/assembly-edge.js';
import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';

it('uses each measured kind’s facing at shared exterior edges and preserves corners', () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  const opening = { cell: cells[0]!, edge: 'yMin' as const };
  for (const [kind, cornerFacings, assetSlug] of [
    ['fence', ['E', 'N', 'W'], 'fence-b1'],
    ['stone', ['E', 'N', 'S'], 'wall-f1'],
    ['timber', ['E', 'N', 'S'], 'wall-c1'],
  ] as const) {
    const closed = edgeRun(cells, kind);
    const gate = edgeRun(cells, kind, [opening]);
    expect(closed.placements).toHaveLength(6);
    expect(gate.placements).toHaveLength(5);
    expect(gate.postVertices).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(gate.placements.every(({ asset }) => asset.includes(assetSlug))).toBe(true);
    const map = new IsoMap(assemblyMap(2, 1, gate.placements));
    expect(map.pieces('wall')).toHaveLength(5);
    expect(
      map
        .pieces('wall')
        .filter(({ x }) => x === 1)
        .map(({ facing }) => facing)
        .sort(),
    ).toEqual(cornerFacings);
  }
  expect(() => edgeRun(cells, 'fence', [{ cell: cells[0]!, edge: 'xMax' }])).toThrow('exterior');
});

it('assembles an open polyline and leaves its selected opening', () => {
  const run = edgeRun(
    {
      vertices: [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
      ],
      interior: 'right',
    },
    'fence',
    [{ cell: { x: 1, y: 1 }, edge: 'yMin' }],
  );
  expect(run.placements).toHaveLength(3);
  expect(run.postVertices).toEqual([
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);
  expect(new IsoMap(assemblyMap(4, 4, run.placements)).pieces('wall')).toHaveLength(3);
  expect(() =>
    edgeRun(
      {
        vertices: [
          { x: 1, y: 1 },
          { x: 3, y: 1 },
        ],
        interior: 'right',
      },
      'fence',
      [{ cell: { x: 2, y: 1 }, edge: 'xMax' }],
    ),
  ).toThrow('exterior');
});

it('keeps a gate walkable when its cell also carries a corner edge', () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  // The south-west corner cell carries both the xMin and yMax fence edges; the gate opens its yMax edge.
  const run = edgeRun(cells, 'fence', [{ cell: { x: 0, y: 2 }, edge: 'yMax' }]);
  const grid = new IsoMap(assemblyMap(3, 3, run.placements)).collisionGrid();
  expect(run.placements.some(({ cell }) => cell.x === 0 && cell.y === 2)).toBe(true);
  expect(grid[2]![0]).toBe(false);
  expect(grid[2]![1]).toBe(true);
});
