import { expect, it } from 'vitest';
import type { GameManifest } from '@ogm/contracts/browser';
import { resolvePaletteThumbnails } from './palette-thumbnails';

it('resolves item art against its own game build for published and preview builds', () => {
  const manifest: GameManifest = {
    id: 'game',
    sdk: '*',
    title: 'Game',
    inputs: { actions: {} },
    presentation: { orientation: 'any', minLogical: { w: 320, h: 180 }, fit: 'responsive' },
    view: 'fixed',
    dimension: '3d',
    capabilities: [],
    palette: {
      categories: [],
      items: [
        { prefab: 'wall', label: 'Wall', category: 'walls', thumbnail: 'art/wall.png' },
        { prefab: 'floor', label: 'Floor', category: 'walls', thumbnail: '/a/floor.png' },
        { prefab: 'dig', label: 'Dig', category: 'walls' },
      ],
    },
    tools: [],
    gizmos: {},
    saves: false,
    overrides: { aliases: {}, retired: [] },
  };
  const published = resolvePaletteThumbnails(manifest, 'https://games.example.test', 'game', 'build', false);
  expect(published.palette.items.map((item) => item.thumbnail)).toEqual([
    'https://games.example.test/g/game/build/art/wall.png',
    'https://games.example.test/a/floor.png',
    undefined,
  ]);
  expect(
    resolvePaletteThumbnails(manifest, 'https://games.example.test', 'game', 'preview', true).palette.items[0]
      ?.thumbnail,
  ).toBe('https://games.example.test/p/game/preview/art/wall.png');
  expect(manifest.palette.items[0]?.thumbnail).toBe('art/wall.png');
});
