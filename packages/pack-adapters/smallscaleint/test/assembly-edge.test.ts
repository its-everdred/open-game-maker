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
