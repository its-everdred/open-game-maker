import { describe, expect, it } from 'vitest';

import { buildCatalog, buildIndex, searchCatalog } from '../src/index.js';
import { FIXTURE } from './helpers.js';

describe('asset catalogue projection', () => {
  it('keeps every catalogued pack, maps cards, and searches by facets and rights', async () => {
    const cards = await buildIndex(FIXTURE);
    const index = buildCatalog(cards, [
      { id: 'kenney-mini-dungeon', title: 'Mini Dungeon', vendor: 'Kenney' },
      { id: 'kenney-music-loops', title: 'Music Loops', vendor: 'Kenney' },
      { id: 'empty-pack', title: 'Empty' },
    ]);
    expect(index.packs.map((pack) => pack.id)).toEqual(['empty-pack', 'kenney-mini-dungeon', 'kenney-music-loops']);
    const orc = index.assets.find((asset) => asset.id.includes('character-orc'))!;
    expect(orc.kind).toBe('model');
    expect(orc.rights).toMatchObject(cards.cards.find((card) => card.id === orc.id)!.resolved.rights);
    expect(orc.previews.thumb).toContain('/media/thumb');
    expect(orc.usedIn).toEqual([]);
    expect(searchCatalog(index, { words: 'orc', kind: 'model' }).map((asset) => asset.id)).toEqual([orc.id]);
    expect(searchCatalog(index, { words: 'orc', kind: 'music' })).toEqual([]);
    expect(searchCatalog(index, { words: 'orc', use: 'not-a-use' })).toEqual([]);
    expect(index.assets.some((asset) => asset.kind === 'music')).toBe(true);
  });

  it('does not count the same broad and detailed collection totals twice', async () => {
    const cards = await buildIndex(FIXTURE);
    const collection = cards.cards.find((card) => card.id.startsWith('t1:kenney-mini-dungeon@'))!;
    collection.collection_info!.counts = { model: 10, 'model/character': 3 };
    const index = buildCatalog(cards, [{ id: 'kenney-mini-dungeon' }]);
    expect(index.packs[0]!.counts.model).toBe(10);
  });
});
