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

it('retains multiple wall pieces in a corner using distinct Tiled layers', () => {
  const cell = { x: 0, y: 0 };
  const map = new IsoMap(
    assemblyMap(1, 1, [
      { cell, layer: 'wall', asset: 'fence', facing: 'W', solid: true },
      { cell, layer: 'wall', asset: 'fence', facing: 'S', solid: true },
    ]),
  );
  expect(map.pieces('wall').map(({ facing }) => facing)).toEqual(['W', 'S']);
  expect(new Set(map.pieces('wall').map(({ key }) => key)).size).toBe(2);
});

it('keeps a gate annotation on only the marked floor cell', () => {
  const floor = { layer: 'floor', asset: 'grass', facing: 'E', solid: false } as const;
  const tiled = assemblyMap(2, 1, [
    { ...floor, cell: { x: 0, y: 0 } },
    { ...floor, cell: { x: 1, y: 0 }, tags: ['gate'] },
  ]);
  const layer = tiled.layers[0]!;
  expect(layer.type).toBe('tilelayer');
  if (layer.type !== 'tilelayer') throw new Error('expected floor layer');
  expect(layer.data[0]).not.toBe(layer.data[1]);
  const tiles = tiled.tilesets[0]!.tiles!;
  expect(tiles.find((tile) => tile.id === layer.data[0]! - 1)?.properties).not.toContainEqual({
    name: 'tags',
    value: 'gate',
  });
  expect(tiles.find((tile) => tile.id === layer.data[1]! - 1)?.properties).toContainEqual({
    name: 'tags',
    value: 'gate',
  });
  expect(new IsoMap(tiled).collisionGrid()).toEqual([[false, false]]);
  expect(() => assemblyMap(1, 1, [{ ...floor, cell: { x: 0, y: 0 }, tags: ['gate,exit'] }])).toThrow('tags');
});
