import { expect, it } from 'vitest';

import { assemblyMap } from '../src/assembly-map.js';
import { IsoMap } from '../src/map.js';
import { facingLoader, fakeIsoScene } from './fake-iso-scene.js';

it('retains elevated roof placements and draws them above the footprint', async () => {
  const data = assemblyMap(1, 1, [
    { cell: { x: 0, y: 0 }, layer: 'roof', asset: 'roof', facing: 'S', solid: false, elevation: 1.75 },
  ]);
  const map = new IsoMap(data);
  expect(map.roofTilesAbove(0, 0)[0]?.elevation).toBe(1.75);
  const fake = fakeIsoScene();
  await map.render(fake.scene, facingLoader());
  expect(fake.images[0]?.y).toBe(64 - 1.75 * 64);
  expect(() =>
    assemblyMap(1, 1, [
      { cell: { x: 0, y: 0 }, layer: 'floor', asset: 'floor', facing: 'E', solid: false, elevation: 1 },
    ]),
  ).toThrow('elevation');
  data.tilesets[0]!.tiles[0]!.properties!.find(({ name }) => name === 'elevation')!.value = -1;
  expect(() => new IsoMap(data)).toThrow('elevation');
});
