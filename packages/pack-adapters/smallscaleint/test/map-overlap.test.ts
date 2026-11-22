import { expect, it } from 'vitest';

import { IsoMap } from '../src/map.js';
import { facingLoader, fakeIsoScene } from './fake-iso-scene.js';

it('keeps overlapping wall sprites independent for rendering, state and collision', async () => {
  const tile = (name: string, data: number[]) => ({ type: 'tilelayer' as const, name, width: 1, height: 1, data });
  const map = new IsoMap({
    orientation: 'isometric',
    width: 1,
    height: 1,
    tilewidth: 128,
    tileheight: 64,
    tilesets: [
      {
        firstgid: 1,
        name: 'fence',
        tiles: [
          {
            id: 0,
            properties: [
              { name: 'asset', value: 'fence' },
              { name: 'rotation', value: 180 },
            ],
          },
          {
            id: 1,
            properties: [
              { name: 'asset', value: 'fence' },
              { name: 'rotation', value: 270 },
            ],
          },
        ],
      },
    ],
    layers: [
      tile('floor', [0]),
      tile('wall', [1]),
      tile('wall#1', [2]),
      tile('decor', [0]),
      tile('roof', [0]),
      { type: 'objectgroup', name: 'spawns', objects: [] },
    ],
  });
  const walls = map.pieces('wall');
  expect(walls.map(({ facing }) => facing)).toEqual(['W', 'S']);
  expect(new Set(walls.map(({ key }) => key)).size).toBe(2);
  expect(map.collisionGrid()).toEqual([[true]]);
  const fake = fakeIsoScene();
  const rendered = await map.render(fake.scene, facingLoader());
  expect(rendered.sprites).toHaveLength(2);
  expect(fake.images.map(({ texture }) => texture)).toEqual(['fence:W', 'fence:S']);
  map.sync({ [walls[0]!.key]: { visible: false } });
  expect(map.collisionGrid()).toEqual([[true]]);
  expect(map.pieces('wall').map(({ visible }) => visible)).toEqual([false, true]);
  expect(rendered.sprites.map(({ object }) => object.visible)).toEqual([false, true]);
  map.sync({ [walls[1]!.key]: { visible: false } });
  expect(map.collisionGrid()).toEqual([[false]]);
});
