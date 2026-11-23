import { describe, expect, it } from 'vitest';

import type { EditorLibrary, EditorLibraryItem } from '@ogm/contracts/browser';

import { chooseGroup, filterLibrary, finerChips, matchesQuery, toggleChip } from './library-filter';

const item = (id: string, group: string, tag: string, pack: string, size?: EditorLibraryItem['size']) => ({
  id,
  label: id,
  group,
  tag,
  pack,
  ...(size ? { size } : {}),
});

const library: EditorLibrary = {
  set: 'smallscaleint',
  groups: [
    { id: 'fences', label: 'Fences' },
    { id: 'nature', label: 'Nature' },
  ],
  packs: [
    { id: 'rural', label: 'Zombie Rural' },
    { id: 'fantasy', label: 'Fantasy' },
  ],
  items: [
    item('Fence A1', 'fences', 'Fence', 'rural'),
    item('Fence B1', 'fences', 'Fence', 'rural'),
    item('Tree A1', 'nature', 'Tree', 'fantasy'),
    item('Tree B4', 'nature', 'Tree', 'rural'),
    item('Flora A2', 'nature', 'Flora', 'fantasy'),
  ],
};

describe('library filter', () => {
  it('narrows to fences with one kind chip, so Kevin reaches them in two taps from the closed sheet', () => {
    expect(filterLibrary(library, chooseGroup({ query: '' }, 'fences')).map((piece) => piece.id)).toEqual([
      'Fence A1',
      'Fence B1',
    ]);
  });

  it('offers finer chips only where they split the kind: family words, then packs', () => {
    expect(finerChips(library, { group: 'nature', query: '' })).toEqual([
      { step: 'tag', value: 'Tree', label: 'Tree', count: 2 },
      { step: 'tag', value: 'Flora', label: 'Flora', count: 1 },
      { step: 'pack', value: 'fantasy', label: 'Fantasy', count: 2 },
      { step: 'pack', value: 'rural', label: 'Zombie Rural', count: 1 },
    ]);
    /* Every fence is a Fence from one pack: nothing left to narrow. */
    expect(finerChips(library, { group: 'fences', query: '' })).toEqual([]);
  });

  it('combines finer chips across steps and toggles a chip off with a second tap', () => {
    const trees = toggleChip({ group: 'nature', query: '' }, { step: 'tag', value: 'Tree' });
    const ruralTrees = toggleChip(trees, { step: 'pack', value: 'rural' });
    expect(filterLibrary(library, ruralTrees).map((piece) => piece.id)).toEqual(['Tree B4']);
    expect(toggleChip(ruralTrees, { step: 'pack', value: 'rural' })).toEqual(trees);
  });

  it('drops the old kind’s finer chips when the kind changes, and keeps the search', () => {
    expect(chooseGroup({ group: 'nature', tag: 'Tree', pack: 'rural', query: 'a1' }, 'fences')).toEqual({
      group: 'fences',
      query: 'a1',
    });
    expect(chooseGroup({ group: 'fences', query: '' }, 'fences')).toEqual({ group: undefined, query: '' });
  });

  it('searches label, family, pack and kind by word starts', () => {
    const fence = library.items[0]!;
    expect(matchesQuery(fence, 'fen a1')).toBe(true);
    expect(matchesQuery(fence, 'zombie', 'Zombie Rural')).toBe(true);
    expect(matchesQuery(fence, 'ence')).toBe(false);
    expect(filterLibrary(library, { query: 'fantasy' }).map((piece) => piece.id)).toEqual(['Tree A1', 'Flora A2']);
  });
});
