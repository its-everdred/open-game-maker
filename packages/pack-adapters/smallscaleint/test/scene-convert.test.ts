import { SceneDocSchema, type SceneDoc } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { IsoMap, isoMapToScene, sceneToIsoMap, type TiledIsoMap } from '../src/index.js';
import { fixtureMap4x4 } from './fixtures/map-4x4.js';

const ids = { game: 'dusk-helm', scene: 'study' };

/**
 * A map using everything the Tiled subset can say: a numbered sprite layer, elevation, a non-blocking wall piece
 * (an arch), a blocking decor piece, empty margins, unordered tile ids and spawns with and without a prefab.
 */
function richMap(): TiledIsoMap {
  const width = 6;
  const height = 5;
  const empty = () => Array<number>(width * height).fill(0);
  const at = (data: number[], x: number, y: number, gid: number) => {
    data[y * width + x] = gid;
    return data;
  };
  const floor = empty();
  for (let y = 1; y < 4; y++) for (let x = 1; x < 5; x++) at(floor, x, y, 7);
  return {
    orientation: 'isometric',
    width,
    height,
    tilewidth: 128,
    tileheight: 64,
    tilesets: [
      { firstgid: 5, name: 'b', tiles: [{ id: 2, properties: [{ name: 'asset', value: 'ground-h1' }] }] },
      {
        firstgid: 1,
        name: 'a',
        tiles: [
          {
            id: 0,
            properties: [
              { name: 'asset', value: 'wall-a1' },
              { name: 'rotation', value: 90 },
            ],
          },
          {
            id: 1,
            properties: [
              { name: 'asset', value: 'arch-a1' },
              { name: 'rotation', value: 270 },
              { name: 'solid', value: false },
            ],
          },
          {
            id: 2,
            properties: [
              { name: 'asset', value: 'tree-b4' },
              { name: 'solid', value: true },
              { name: 'rotation', value: -90 },
            ],
          },
          {
            id: 3,
            properties: [
              { name: 'asset', value: 'lantern-a1' },
              { name: 'elevation', value: 1.5 },
            ],
          },
        ],
      },
    ],
    layers: [
      { type: 'tilelayer', name: 'floor', width, height, data: floor },
      { type: 'tilelayer', name: 'wall', width, height, data: at(at(empty(), 1, 1, 1), 2, 1, 2) },
      { type: 'tilelayer', name: 'decor', width, height, data: at(empty(), 3, 2, 3) },
      { type: 'tilelayer', name: 'wall#1', width, height, data: at(empty(), 1, 1, 4) },
      { type: 'tilelayer', name: 'roof', width, height, data: empty() },
      {
        type: 'objectgroup',
        name: 'spawns',
        objects: [
          { id: 2, name: 'mini-boss', x: 320, y: 256 },
          { id: 7, x: 96, y: 128, properties: [{ name: 'prefab', value: 'hero' }] },
        ],
      },
    ],
  };
}

/** What a game sees after loading: every piece and spawn, minus the gid numbering a converter may renumber. */
function loaded(json: TiledIsoMap) {
  const map = new IsoMap(json);
  return {
    width: map.width,
    height: map.height,
    pieces: map.pieces().map((piece) => ({ ...piece, gid: 0 })),
    spawns: map.spawns,
  };
}

describe('isoMapToScene / sceneToIsoMap', () => {
  it.each([
    ['the 4x4 fixture', fixtureMap4x4() as TiledIsoMap],
    ['a map with numbered layers, elevation, margins and odd solids', richMap()],
  ])('loads %s identically after a trip through a scene document', (_name, json) => {
    const doc = isoMapToScene(json, ids);

    expect(SceneDocSchema.safeParse(doc).success).toBe(true);
    expect(loaded(sceneToIsoMap(doc))).toEqual(loaded(json));
  });

  it('writes each piece as a cell-keyed tile, with solid only where it differs from the layer default', () => {
    const doc = isoMapToScene(richMap(), ids);

    expect(doc.bounds).toEqual({ width: 6, height: 5 });
    expect(Object.keys(doc.layers)).toEqual(['floor', 'wall', 'decor', 'wall-1', 'roof', 'spawns']);
    expect(doc.layers.wall!.tiles).toEqual({
      '1,1': { asset: 'wall-a1', facing: 'N' },
      '2,1': { asset: 'arch-a1', facing: 'S', props: { solid: false } },
    });
    expect(doc.layers.decor!.tiles).toEqual({ '3,2': { asset: 'tree-b4', facing: 'S', props: { solid: true } } });
    expect(doc.layers['wall-1']!.tiles).toEqual({ '1,1': { asset: 'lantern-a1', facing: 'E', elevation: 1.5 } });
    expect(doc.objects).toEqual({
      'spawn-2': { asset: 'spawn', layer: 'spawns', pose: { x: 5, y: 4 }, props: { name: 'mini-boss' } },
      'spawn-7': { asset: 'spawn', layer: 'spawns', pose: { x: 1.5, y: 2 }, props: { prefab: 'hero' } },
    });
  });

  it('gives back the same document after a trip through the Tiled map', () => {
    // An agent edits the document, the game converts it, and the next pull must see exactly what was pushed.
    const doc = isoMapToScene(richMap(), ids);
    doc.layers.decor!.tiles!['4,3'] = { asset: 'chest-a1', facing: 'W' };
    doc.objects['spawn-9'] = { asset: 'spawn', layer: 'spawns', pose: { x: 2.25, y: 3 } };

    expect(isoMapToScene(sceneToIsoMap(doc), ids)).toEqual(doc);
  });

  it('draws a tile without a facing as east, the pack rotation 0', () => {
    const doc = isoMapToScene(richMap(), ids);
    doc.layers.decor!.tiles!['4,3'] = { asset: 'chest-a1' };

    const piece = new IsoMap(sceneToIsoMap(doc)).pieces('decor').find((candidate) => candidate.x === 4);
    expect(piece).toMatchObject({ asset: 'chest-a1', facing: 'E', solid: false });
  });

  it.each<[string, (doc: SceneDoc) => void, RegExp]>([
    ['a flipped tile', (doc) => (doc.layers.decor!.tiles!['3,2']!.flip = true), /flipped/],
    ['an unknown tile prop', (doc) => (doc.layers.decor!.tiles!['3,2']!.props = { glow: 1 }), /props glow/],
    ['a tile off the grid', (doc) => (doc.layers.decor!.tiles!['6,0'] = { asset: 'x' }), /outside 6x5/],
    ['a facing the pack never drew', (doc) => (doc.layers.decor!.tiles!['3,2']!.facing = 'NE'), /not E, N, W or S/],
    ['no bounds', (doc) => delete doc.bounds, /no bounds/],
    ['another pack', (doc) => (doc.packAdapter = 'kaykit'), /pack adapter is kaykit/],
    [
      'an objects layer other than spawns',
      (doc) => (doc.layers.props = { kind: 'objects', order: 9 }),
      /objects layer "props"/,
    ],
    ['a spawn with a facing', (doc) => (doc.objects['spawn-2']!.facing = 'S'), /spawn "spawn-2" has facing/],
    [
      'a spawn that is not named spawn-<number>',
      (doc) => (doc.objects.player = { asset: 'spawn', layer: 'spawns', pose: { x: 0, y: 0 } }),
      /spawn-<number>/,
    ],
  ])('refuses %s instead of dropping it', (_name, change, message) => {
    const doc = isoMapToScene(richMap(), ids);
    change(doc);

    expect(() => sceneToIsoMap(doc)).toThrow(message);
  });
});
