import { expect, it } from 'vitest';

import { assemblyMap, type AssemblyPlacement } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';

it('creates a Tiled map that IsoMap reads with distinct facing and collision data', () => {
  const placements: AssemblyPlacement[] = [
    { cell: { x: 0, y: 0 }, layer: 'floor', asset: 'paving', facing: 'E', solid: false },
    { cell: { x: 1, y: 0 }, layer: 'floor', asset: 'paving', facing: 'E', solid: false },
    { cell: { x: 0, y: 1 }, layer: 'wall', asset: 'fence', facing: 'W', solid: true },
    { cell: { x: 1, y: 1 }, layer: 'decor', asset: 'shrub', facing: 'S', solid: false },
  ];
  const tiled = assemblyMap(2, 2, placements);
  const map = new IsoMap(tiled);
  expect(map.pieces().map(({ asset, facing, solid }) => ({ asset, facing, solid }))).toEqual([
    { asset: 'paving', facing: 'E', solid: false },
    { asset: 'paving', facing: 'E', solid: false },
    { asset: 'fence', facing: 'W', solid: true },
    { asset: 'shrub', facing: 'S', solid: false },
  ]);
  expect(map.collisionGrid()).toEqual([
    [false, false],
    [true, false],
  ]);
  expect(tiled.tilesets[0]!.tiles).toHaveLength(3);
  expect(() => assemblyMap(2, 2, [...placements, placements[0]!])).toThrow('multiple floor');
  expect(() => assemblyMap(2, 2, [{ ...placements[0]!, solid: 1 as unknown as boolean }])).toThrow('boolean');
  expect(() => assemblyMap(2, 2, [{ ...placements[0]!, facing: 'toString' as AssemblyPlacement['facing'] }])).toThrow(
    'invalid',
  );
  expect(() => assemblyMap(2, 2, [{ ...placements[0]!, cell: { x: 2, y: 0 } }])).toThrow('outside');
});
