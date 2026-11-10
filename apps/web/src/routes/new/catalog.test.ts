import { describe, expect, it } from 'vitest';

import { pickerFamilies, setsForFamily, styleChoices, type CatalogFamily } from './catalog';

const family: CatalogFamily = {
  id: 'isometric-2d',
  label: 'Isometric 2D',
  views: ['iso', 'follow'],
  creationChoice: true,
  packs: [],
  sets: [
    {
      id: 'public-set',
      label: 'Public set',
      pickerFamilies: ['pixel-art'],
      vendors: ['kenney'],
      traits: {},
      showcase: { stops: [] },
      packs: [
        { id: 'authored', name: 'Authored', thumbnailUrl: '/authored.png', aiGenerated: false },
        { id: 'generated', name: 'Generated', thumbnailUrl: '/generated.png', aiGenerated: true },
      ],
    },
    {
      id: 'licensed-set',
      label: 'Licensed set',
      pickerFamilies: [],
      vendors: ['vendor'],
      traits: {},
      packs: [],
    },
  ],
};

describe('styleChoices', () => {
  it('uses each catalog set as one creation choice', () => {
    expect(styleChoices([family])).toEqual([
      expect.objectContaining({ id: 'public-set', familyId: 'isometric-2d' }),
      expect.objectContaining({ id: 'licensed-set', familyId: 'isometric-2d' }),
    ]);
  });

  it('keeps canonical choices unique while exposing picker-family aliases', () => {
    const pixel: CatalogFamily = {
      ...family,
      id: 'pixel-art',
      label: 'Pixel art',
      sets: [],
    };

    expect(styleChoices([pixel, family]).map(({ id }) => id)).toEqual(['pixel-art', 'public-set', 'licensed-set']);
    expect(setsForFamily([pixel, family], 'pixel-art').map(({ id }) => id)).toEqual(['pixel-art', 'public-set']);
  });

  it('returns only creation families and uses the picker label for Isometric', () => {
    expect(pickerFamilies([family])).toEqual([expect.objectContaining({ id: 'isometric-2d', label: 'Isometric' })]);
    expect(pickerFamilies([{ ...family, creationChoice: false }])).toEqual([]);
  });

  it('removes generated packs and choices when the game setting is off', () => {
    const choices = setsForFamily([family], 'isometric-2d', false);

    expect(choices.map(({ id }) => id)).toEqual(['public-set', 'licensed-set']);
    expect(choices[0]?.packs).toEqual([
      { id: 'authored', name: 'Authored', thumbnailUrl: '/authored.png', aiGenerated: false },
    ]);
    expect(setsForFamily([family], 'isometric-2d', true)[0]?.packs).toHaveLength(2);
    expect(choices[0]?.showcase).toBeUndefined();
    expect(setsForFamily([family], 'isometric-2d', true)[0]?.showcase).toBeUndefined();
  });
});
