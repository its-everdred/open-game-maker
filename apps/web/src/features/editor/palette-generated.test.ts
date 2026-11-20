import { expect, it } from 'vitest';
import { annotateGeneratedPalette } from './palette-generated';

it('marks native items that reference a generated locked asset', () => {
  const native = {
    categories: [],
    items: [
      { prefab: 'tree', label: 'Tree', category: 'props', assetId: 't1:set/tree@1' },
      { prefab: 'rock', label: 'Rock', category: 'props' },
    ],
  };
  const catalog = {
    categories: [],
    items: [{ prefab: 't1:set/tree@1', label: 'Tree', category: 'props', madeByGameMaker: true }],
  };
  expect(annotateGeneratedPalette(native, catalog).items).toEqual([
    { ...native.items[0], madeByGameMaker: true },
    native.items[1],
  ]);
});
