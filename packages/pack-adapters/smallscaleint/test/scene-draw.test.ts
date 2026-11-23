import { describe, expect, it } from 'vitest';

import { cellAt, cellCenter, IsoMap, isoMapToScene, sceneDrawList, sceneToIsoMap } from '../src/index.js';
import { facingLoader, fakeIsoScene } from './fake-iso-scene.js';
import { fixtureMap4x4 } from './fixtures/map-4x4.js';

describe('sceneDrawList', () => {
  const doc = isoMapToScene(fixtureMap4x4(), { game: 'g', scene: 's' });

  it('places and orders every raised piece exactly where IsoMap.render does', async () => {
    // The editor draws scenes in the page without Phaser; if it drifted from the game, Kevin would place a piece on
    // one cell and see it in the game on another.
    const fake = fakeIsoScene();
    await new IsoMap(sceneToIsoMap(doc)).render(fake.scene, facingLoader());
    const raised = sceneDrawList(doc).filter((piece) => !piece.floor);
    expect(raised.map((piece) => `${piece.asset}:${piece.facing}`)).toEqual(fake.images.map((image) => image.texture));
    expect(raised.map((piece) => [piece.center.x, piece.center.y])).toEqual(
      fake.images.map((image) => [image.x, image.y]),
    );
    // The fake textures are 256 px tall: IsoMap's origin is the anchor row over the image height.
    expect(raised.map((piece) => piece.anchorY / 256)).toEqual(fake.images.map((image) => image.origin[1]));
  });

  it('draws the floor first, row by row, at the tile centres the floor tilemap uses', () => {
    const list = sceneDrawList(doc);
    const floor = list.filter((piece) => piece.floor);
    expect(list.slice(0, floor.length)).toEqual(floor);
    expect(floor.map((piece) => piece.cell)).toEqual(
      Array.from({ length: 16 }, (_, index) => `${index % 4},${Math.floor(index / 4)}`),
    );
    // Phaser puts floor tile (x, y) at ((x - y) * 64, (x + y) * 32) from the layer origin set in IsoMap.render.
    for (const piece of floor) {
      expect(piece.center).toEqual({ x: 4 * 64 + (piece.x - piece.y) * 64, y: 64 + (piece.x + piece.y) * 32 });
    }
  });

  it('leaves hidden layers out, so the editor can see under roofs', () => {
    const hidden = structuredClone(doc);
    hidden.layers.wall!.visible = false;
    expect(sceneDrawList(hidden).some((piece) => piece.layer === 'wall')).toBe(false);
  });
});

describe('cellAt', () => {
  const doc = isoMapToScene(fixtureMap4x4(), { game: 'g', scene: 's' });

  it('finds the cell whose ground diamond holds the point', () => {
    for (const [x, y] of [
      [0, 0],
      [3, 1],
      [2, 3],
    ] as const) {
      const centre = cellCenter(doc, x, y);
      expect(cellAt(doc, centre)).toEqual({ x, y });
      // Near the diamond's corners (inside it) still picks the same cell.
      expect(cellAt(doc, { x: centre.x + 60, y: centre.y })).toEqual({ x, y });
      expect(cellAt(doc, { x: centre.x, y: centre.y - 30 })).toEqual({ x, y });
    }
  });

  it('is undefined off the map', () => {
    expect(cellAt(doc, { x: -500, y: -500 })).toBeUndefined();
    expect(cellAt(doc, cellCenter(doc, 4, 0))).toBeUndefined();
  });
});
