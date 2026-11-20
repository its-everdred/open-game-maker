import { describe, expect, it } from 'vitest';

import { IsoMap, isoToWorld, worldToIso } from '../src/index.js';
import { facingLoader, fakeIsoScene } from './fake-iso-scene.js';
import { fixtureMap4x4 } from './fixtures/map-4x4.js';

describe('isometric projection', () => {
  it('round trips tile coordinates through the 128x64 diamond', () => {
    expect(isoToWorld(1, 0)).toEqual({ x: 64, y: 32 });
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [3, 2],
      [1.5, 2.25],
    ]) {
      const world = isoToWorld(x!, y!);
      expect(worldToIso(world.x, world.y)).toEqual({ x, y });
    }
  });
});

describe('IsoMap', () => {
  it('normalizes gids into locked asset pieces and chooses facing from rotation', () => {
    const map = new IsoMap(fixtureMap4x4());
    expect(map.pieces('wall').map(({ asset, facing, x, y }) => ({ asset, facing, x, y }))).toEqual([
      { asset: 'wall-01', facing: 'E', x: 1, y: 1 },
      { asset: 'door-01', facing: 'N', x: 2, y: 1 },
    ]);
    expect(map.pieces('decor').map((piece) => piece.facing)).toEqual(['E', 'N', 'W', 'S']);
  });

  it('sorts tall pieces by their projected footprint and keeps a stable layer order', () => {
    const map = new IsoMap(fixtureMap4x4());
    const shallow = map.pieces('wall')[0]!;
    const deep = map.pieces('decor')[3]!;
    expect(shallow.depth).toBeLessThan(deep.depth);
    expect(map.depthOf(1, 1, 'wall')).toBeLessThan(map.depthOf(1, 1, 'roof'));
  });

  it('builds wall collision and lets the game toggle a door by generic piece state', () => {
    const map = new IsoMap(fixtureMap4x4());
    expect(map.collisionGrid()[1]!.slice(0, 4)).toEqual([false, true, true, false]);
    const door = map.pieces('wall').find((piece) => piece.asset === 'door-01')!;
    map.sync({ [door.key]: { solid: false } });
    expect(map.collisionGrid()[1]!.slice(0, 4)).toEqual([false, true, false, false]);
    map.sync({ [door.key]: { solid: true, visible: false } });
    expect(map.collisionGrid()[1]![2]).toBe(false);
  });

  it('lists visible roofs above a cell and applies destructible visibility state', () => {
    const map = new IsoMap(fixtureMap4x4());
    const roof = map.roofTilesAbove(1, 1);
    expect(roof.map((piece) => piece.asset)).toEqual(['roof-01']);
    map.sync({ [roof[0]!.key]: { visible: false } });
    expect(map.roofTilesAbove(1, 1)).toEqual([]);
  });

  it('exposes spawn objects without assigning gameplay meaning', () => {
    const map = new IsoMap(fixtureMap4x4());
    expect(map.spawns).toEqual([{ id: 1, name: 'player', prefab: 'hero', x: 0, y: 128 }]);
  });

  it('rejects maps outside the finite 128x64 subset and unresolved gids', () => {
    expect(() => new IsoMap({ ...fixtureMap4x4(), orientation: 'orthogonal' })).toThrow(/isometric/);
    expect(() => new IsoMap({ ...fixtureMap4x4(), infinite: true })).toThrow(/finite/);
    expect(() => new IsoMap({ ...fixtureMap4x4(), tileheight: 256 })).toThrow(/128x64/);

    const missing = fixtureMap4x4();
    missing.layers[0]!.data[0] = 99;
    expect(() => new IsoMap(missing)).toThrow(/gid 99/);
  });

  it('rejects malformed layers and tile properties', () => {
    const duplicate = fixtureMap4x4();
    duplicate.layers.push({ ...duplicate.layers[0]!, data: [...duplicate.layers[0]!.data] });
    expect(() => new IsoMap(duplicate)).toThrow(/appears twice/);

    const unknown = fixtureMap4x4();
    unknown.layers[1]!.name = 'water';
    expect(() => new IsoMap(unknown)).toThrow(/not one of/);

    const missingLayer = fixtureMap4x4();
    missingLayer.layers.pop();
    expect(() => new IsoMap(missingLayer)).toThrow(/missing required layer "spawns"/);

    const badRotation = fixtureMap4x4();
    badRotation.tilesets[0]!.tiles[0]!.properties[1]!.value = 45;
    expect(() => new IsoMap(badRotation)).toThrow(/rotation must be one of/);

    const badSolid = fixtureMap4x4();
    badSolid.tilesets[0]!.tiles[1]!.properties[2]!.value = 'yes';
    expect(() => new IsoMap(badSolid)).toThrow(/solid must be a boolean/);
  });

  it('renders floor through a Phaser isometric tilemap and tall pieces as sorted facing sprites', async () => {
    const fake = fakeIsoScene();
    const map = new IsoMap(fixtureMap4x4());
    const rendered = await map.render(fake.scene, facingLoader());

    expect(fake.tilemaps).toHaveLength(1);
    expect(fake.tilemaps[0]).toMatchObject({ orientationAtCreate: 1, depth: -1 });
    expect(fake.tilemaps[0]!.tiles).toEqual(Array.from({ length: 4 }, () => [1, 1, 1, 1]));
    expect(fake.tilemaps[0]!.tilesets[0]).toEqual([
      'gid-1',
      expect.stringMatching(/^smallscaleint-floor:/),
      256,
      256,
      0,
      0,
      1,
    ]);
    expect(rendered.sprites).toHaveLength(7);
    expect(fake.images.filter((image) => image.texture.startsWith('chest:')).map((image) => image.texture)).toEqual([
      'chest:E',
      'chest:N',
      'chest:W',
      'chest:S',
    ]);
    expect(fake.images.map((image) => image.depth)).toEqual(
      [...fake.images.map((image) => image.depth)].sort((a, b) => a - b),
    );

    const door = map.pieces('wall').find((piece) => piece.asset === 'door-01')!;
    map.sync({ [door.key]: { visible: false } });
    expect(rendered.sprites.find((sprite) => sprite.key === door.key)!.object.visible).toBe(false);

    const floor = map.pieces('floor')[0]!;
    map.sync({ [floor.key]: { visible: false } });
    expect(fake.tilemaps[0]!.tiles![0]![0]).toBe(-1);
    expect(map.hasFloor(0, 0)).toBe(false);
    map.sync({ [floor.key]: { visible: true } });
    expect(fake.tilemaps[0]!.tiles![0]![0]).toBe(floor.gid);
    expect(map.hasFloor(0, 0)).toBe(true);
  });

  it.each([128, 256])('anchors a %i-wide floor image at the cell centre', async (width) => {
    const fake = fakeIsoScene([], width);
    await new IsoMap(fixtureMap4x4()).render(fake.scene, facingLoader());
    expect(fake.tilemaps[0]!.tilesets[0]).toEqual([
      'gid-1',
      expect.stringMatching(/^smallscaleint-floor:/),
      width,
      256,
      0,
      0,
      1,
    ]);
    expect(fake.tilemaps[0]!.position).toEqual([256 - width / 2, -144]);
  });

  it('rejects a piece whose selected facing is absent from its card', async () => {
    await expect(new IsoMap(fixtureMap4x4()).render(fakeIsoScene().scene, facingLoader('door-01:N'))).rejects.toThrow(
      'Asset door-01 has no N isometric facing',
    );
  });

  it('renders state synchronized while its facing textures load', async () => {
    const fake = fakeIsoScene();
    const map = new IsoMap(fixtureMap4x4());
    const rendering = map.render(fake.scene, facingLoader());
    const floor = map.pieces('floor')[0]!;
    const door = map.pieces('wall').find((piece) => piece.asset === 'door-01')!;
    map.sync({ [floor.key]: { visible: false }, [door.key]: { visible: false } });

    const rendered = await rendering;
    expect(fake.tilemaps[0]!.tiles![0]![0]).toBe(-1);
    expect(rendered.sprites.find((sprite) => sprite.key === door.key)!.object.visible).toBe(false);
  });

  it('reports only its own missing facing texture', async () => {
    const fake = fakeIsoScene(['door-01:N']);
    await expect(new IsoMap(fixtureMap4x4()).render(fake.scene, facingLoader())).rejects.toThrow(
      'Failed to load isometric pieces: door-01:N (https://game.test/door-01_N.png)',
    );
  });
});
