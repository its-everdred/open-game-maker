import { expect, it } from 'vitest';

import { IsoMap, assemblyMap, building, edgeRun, path, scatter, type Cell } from '../src/index.js';

const key = ({ x, y }: Cell) => `${x},${y}`;

// A churchyard composed only from the public assemblers: the scene a game would otherwise place one sprite at a time.
it('composes a fenced yard whose gate path reaches the chapel door and stays clear of dressing', () => {
  const yard = Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8) }));
  const gate = { cell: { x: 3, y: 7 }, edge: 'yMax' as const };
  const fence = edgeRun(yard, 'fence', [gate]);

  const chapelCells = Array.from({ length: 6 }, (_, i) => ({ x: 2 + (i % 3), y: 1 + Math.floor(i / 3) }));
  const chapelSet = new Set(chapelCells.map(key));
  const walkable = yard.filter((cell) => !chapelSet.has(key(cell)));
  const chapel = building(chapelCells, 'stone', { cell: { x: 3, y: 2 }, edge: 'yMax' }, walkable);

  const route = path(gate.cell, chapel.entry, {
    walkable,
    palette: [{ asset: 'stones-a', facing: 'E' }],
    seed: 3,
  });
  const reserved = [
    ...fence.placements.map(({ cell }) => cell),
    ...route.map(({ cell }) => cell),
    chapel.entry,
    gate.cell,
    ...chapelCells,
  ];
  const dressing = scatter(walkable, [{ asset: 'grave', facing: 'S', solid: true, footprint: [{ x: 0, y: 0 }] }], 0.6, {
    seed: 11,
    avoid: reserved,
    boundaries: yard.filter(({ x, y }) => x === 0 || y === 0 || x === 7 || y === 7),
    boundaryDensity: 0.3,
  });

  const map = new IsoMap(assemblyMap(8, 8, [...fence.placements, ...chapel.placements, ...route, ...dressing]));
  const solid = map.collisionGrid();
  const routeCells = route.map(({ cell }) => cell);

  // The route is unbroken from the gate to the door, so a player can walk it.
  expect(routeCells[0]).toEqual(gate.cell);
  expect(routeCells.at(-1)).toEqual(chapel.entry);
  for (let i = 1; i < routeCells.length; i++) {
    const a = routeCells[i - 1]!;
    const b = routeCells[i]!;
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
  }
  for (const { x, y } of routeCells) expect(solid[y]![x]).toBe(false);
  // Dressing never lands on the path, the door's entry or the gate.
  expect(dressing.length).toBeGreaterThan(0);
  const blocked = new Set([...routeCells, chapel.entry, gate.cell].map(key));
  expect(dressing.some(({ cell }) => blocked.has(key(cell)))).toBe(false);
  const fenceCells = new Set(fence.placements.map(({ cell }) => key(cell)));
  expect(dressing.some(({ cell }) => fenceCells.has(key(cell)))).toBe(false);
  // The roof covers the whole chapel and the fence keeps exactly one gap.
  for (const { x, y } of chapelCells) expect(map.roofTilesAbove(x, y)).toHaveLength(1);
  expect(fence.placements).toHaveLength(31);
  expect(fence.postVertices).toEqual([
    { x: 3, y: 8 },
    { x: 4, y: 8 },
  ]);
});

it('refuses building styles it cannot assemble', () => {
  expect(() =>
    building([{ x: 0, y: 0 }], 'glass' as 'stone', { cell: { x: 0, y: 0 }, edge: 'yMax' }, [{ x: 0, y: 1 }]),
  ).toThrow('only stone and timber building styles are assembled');
});
