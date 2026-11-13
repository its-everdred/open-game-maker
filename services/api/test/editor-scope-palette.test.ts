import { describe, expect, it } from 'vitest';

import { scopePaletteItems } from '../src/scenery/scope-palette.js';

describe('scope fallback palette', () => {
  it('exposes included scope as categorized request choices, never excluded items', () => {
    expect(
      scopePaletteItems({
        scope: {
          included: ['A forest of trees', 'Friendly goblin characters', 'A music track'],
          excluded: ['Dragons'],
        },
      }),
    ).toEqual([
      { prefab: 'scope:0', label: 'A forest of trees', category: 'scenery' },
      { prefab: 'scope:1', label: 'Friendly goblin characters', category: 'characters' },
      { prefab: 'scope:2', label: 'A music track', category: 'audio' },
    ]);
  });
});
