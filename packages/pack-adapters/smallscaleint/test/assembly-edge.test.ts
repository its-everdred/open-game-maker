import { expect, it } from 'vitest';

import { edgeRun } from '../src/assembly-edge.js';
import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';
import { fenceB1Edges, wallC1Edges, wallF1Edges } from '../src/structural-bounds.js';

it('uses each measured kind’s facing at shared exterior edges and preserves corners', () => {
  const cells = Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  const opening = { cell: { x: 1, y: 0 }, edge: 'yMin' as const };
  for (const [kind, table, assetSlug] of [
    ['fence', fenceB1Edges, 'fence-b1'],
    ['stone', wallF1Edges, 'wall-f1'],
    ['timber', wallC1Edges, 'wall-c1'],
  ] as const) {
    const facingOf = (edge: string) => Object.entries(table.value).find(([, value]) => value === edge)![0];
    const closed = edgeRun(cells, kind);
    const gate = edgeRun(cells, kind, [opening]);
    expect(closed.placements).toHaveLength(10);
    expect(gate.placements).toHaveLength(9);
    expect(gate.postVertices).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(gate.placements.every(({ asset }) => asset.includes(assetSlug))).toBe(true);
    const map = new IsoMap(assemblyMap(3, 2, gate.placements));
    expect(map.pieces('wall')).toHaveLength(9);
    // The corner cell keeps both of its sides, so neighbouring runs meet without a gap.
    expect(
      map
        .pieces('wall')
        .filter(({ x, y }) => x === 2 && y === 0)
        .map(({ facing }) => facing)
        .sort(),
    ).toEqual([facingOf('xMax'), facingOf('yMin')].sort());
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

it('refuses a corner gate, whose cell would stay solid and seal the way in', () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }));
  expect(() => edgeRun(cells, 'fence', [{ cell: { x: 0, y: 2 }, edge: 'yMax' }])).toThrow('corner');
  // The mid-side gate leaves its cell with no other edge, so the way in stays open.
  const run = edgeRun(cells, 'fence', [{ cell: { x: 1, y: 2 }, edge: 'yMax' }]);
  const grid = new IsoMap(assemblyMap(3, 3, run.placements)).collisionGrid();
  expect([grid[2]![1], grid[1]![1]]).toEqual([false, false]);
});

it('places scaled posts at the inspected gate ends without blocking the entry', () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({ x: 2 + (i % 3), y: 2 + Math.floor(i / 3) }));
  const gate = { cell: { x: 3, y: 4 }, edge: 'yMax' as const };
  const style = {
    asset: 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/stone-a14@2026-11-01',
    facing: 'E' as const,
    scale: 0.4,
  };
  const run = edgeRun(cells, 'fence', [gate], style);
  const map = new IsoMap(assemblyMap(6, 6, run.placements));
  expect(map.pieces('decor').map(({ x, y, scale, elevation, solid }) => ({ x, y, scale, elevation, solid }))).toEqual([
    { x: 3, y: 5, scale: 0.4, elevation: 0.5, solid: false },
    { x: 4, y: 5, scale: 0.4, elevation: 0.5, solid: false },
  ]);
  expect(run.placements.filter((placement) => placement.layer === 'decor').map((placement) => placement.role)).toEqual([
    'post',
    'post',
  ]);
  expect(map.collisionGrid()[4]![3]).toBe(false);
  expect(() => edgeRun(cells, 'fence', [{ cell: { x: 3, y: 2 }, edge: 'yMin' }], style)).toThrow('only inspected');
  expect(() => edgeRun(cells, 'fence', [gate], { ...style, scale: 0.5 })).toThrow('only inspected');
});

it('explains the required margin when gate posts fall beyond the map edge', () => {
  const cells = Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) }));
  const gate = { cell: { x: 1, y: 3 }, edge: 'yMax' as const };
  const style = {
    asset: 't1:smallscaleint-fantasy-tileset-2d-isometric/tiles/environment/stone-a14@2026-11-01',
    facing: 'E' as const,
    scale: 0.4,
  };
  const run = edgeRun(cells, 'fence', [gate], style);
  expect(() => assemblyMap(4, 4, run.placements)).toThrow('gate posts need a one-cell map margin');
});
