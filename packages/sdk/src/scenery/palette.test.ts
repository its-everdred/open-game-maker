import { describe, expect, it } from 'vitest';
import { sceneryPalette } from './palette.js';

describe('scenery palette', () => {
  it('offers only locked items under the scenery tabs', () => {
    const palette = sceneryPalette(
      [
        { assetId: 'oak', name: 'Oak', category: 'trees', thumbnail: '/oak.png', sha256: 'abc' },
        { assetId: 'stone', name: 'Stone', category: 'rocks' },
      ],
      [{ id: 'oak' }],
    );
    expect(palette.categories.map((item) => item.label)).toEqual(['Trees', 'Rocks', 'Water', 'Props', 'Light']);
    expect(palette.items).toEqual([
      { prefab: 'scenery:oak', label: 'Oak', category: 'trees', thumbnail: '/oak.png', assetSha: 'abc' },
      { prefab: 'scenery-band:grass', label: 'Grass', category: 'water' },
      { prefab: 'scenery-band:path', label: 'Path', category: 'water' },
      { prefab: 'scenery-band:water', label: 'Water', category: 'water' },
    ]);
  });
});
