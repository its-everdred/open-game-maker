import type { GameManifest } from '@ogm/contracts/browser';

/** Built-in requestable terrain when the game and its lock offer no palette items. */
export const starterPalette: GameManifest['palette'] = {
  categories: [{ id: 'ground', label: 'Ground', kind: 'items' }],
  items: [
    { prefab: 'scenery-band:grass', label: 'Grass', category: 'ground' },
    { prefab: 'scenery-band:path', label: 'Path', category: 'ground' },
    { prefab: 'scenery-band:water', label: 'Water', category: 'ground' },
  ],
};
