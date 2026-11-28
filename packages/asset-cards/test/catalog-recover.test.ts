import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { loadCatalog } from '../src/index.js';
import { libraryCopy } from './helpers.js';

it('recovers compatible fields from an older card only after validating its parent rights', async () => {
  const root = libraryCopy();
  try {
    const pack = join(root, 'packs', 'kenney-mini-dungeon');
    const collectionPath = join(pack, 'collection.card.json');
    const cardPath = join(pack, 'cards', 'character-orc.card.json');
    const parent = JSON.parse(readFileSync(collectionPath, 'utf8'));
    const card = JSON.parse(readFileSync(cardPath, 'utf8'));
    parent.legacy_metadata = true;
    card.legacy_metadata = true;
    writeFileSync(collectionPath, JSON.stringify(parent));
    writeFileSync(cardPath, JSON.stringify(card));
    writeFileSync(join(root, 'catalog.json'), JSON.stringify({ packs: [{ id: 'kenney-mini-dungeon' }] }));
    const index = await loadCatalog(root);
    const recovered = index.assets.find((asset) => asset.id === card.id);
    expect(recovered?.rights.uses).toContain('in-game');
    expect(recovered?.previews.source).toContain('/media/source');
    expect(index.recovered.has(card.id)).toBe(true);

    parent.rights.basis = [];
    writeFileSync(collectionPath, JSON.stringify(parent));
    rmSync(join(root, 'index', 'cards.index.json'));
    const unsafe = await loadCatalog(root);
    expect(unsafe.assets.some((asset) => asset.id === card.id)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
