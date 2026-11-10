import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildIndex, type CardIndex, type LayoutSpecRow, type ResolvedCard } from '../src/index.js';
import { buildMapIndex, featuresOf, layoutRow, loadMapIndex, writeMapIndex } from '../src/maps.js';
import { FIXTURE, libraryCopy } from './helpers.js';

const ANNUAL = 'inspiration/profantasy-cartographers-annual';

function card(name: string): ResolvedCard {
  return JSON.parse(readFileSync(join(FIXTURE, ANNUAL, 'cards', `${name}.card.json`), 'utf8')) as ResolvedCard;
}

const EXAMPLE_CARD = 't1:profantasy-cartographers-annual/example-dungeon-01@illustrative';

/** C3 §12 columns for the example image, as a validated spec would carry them. */
const SPEC: LayoutSpecRow = {
  id: 'layout:profantasy-cartographers-annual/example-dungeon-01@illustrative#1',
  source: { card_id: EXAMPLE_CARD, content_hash: `sha256:${'0'.repeat(64)}`, required_use: 'derive-layout' },
  grid: { type: 'square', cols: 48, rows: 36, cell_px: 50, confidence: 0.9 },
  rooms: [],
  connections: [],
  features: [],
  tags: {
    computed: {
      room_count: 7,
      connection_count: 9,
      loop_count: 1,
      entrance_count: 1,
      dead_end_count: 1,
      secret_count: 1,
      size_class: 'medium',
    },
    judged: { map_type: 'dungeon', themes: ['dungeon', 'crypt'], flow: 'hub-and-spoke', confidence: 0.7 },
  },
};

function resolved(cardDoc: ResolvedCard, uses: string[], environments?: string[]): ResolvedCard {
  return {
    ...cardDoc,
    resolved: {
      license: 'CC0-1.0',
      rights: { uses: uses as never, audience: 'public', redistribution: 'free' },
      environments: environments ?? cardDoc.describe?.environments,
      provenance: {},
    },
  };
}

describe('layoutRow', () => {
  it('joins the layout spec graph counts and keeps the card own columns first', () => {
    const document = card('example-dungeon-01');
    document.map = { ...document.map!, layout_spec: { id: SPEC.id, status: 'extracted' }, layout: { levels: 2 } };
    const row = layoutRow(resolved(document, ['derive-layout']), SPEC);
    expect(row).toMatchObject({
      resource: 'map',
      type: 'dungeon',
      biome: 'dungeon',
      scale: null,
      grid: 'square',
      cell_px: 50,
      rooms: 7,
      connections: 9,
      loops: 1,
      secrets: 1,
      dead_ends: 1,
      levels: 2,
      size: 'medium',
      flow: 'hub-and-spoke',
      from: 'spec',
    });
  });

  it('takes card layout columns when no spec exists, and marks the row as card-derived', () => {
    const document = card('example-dungeon-01');
    document.map = {
      ...document.map!,
      layout_spec: { status: 'pending' },
      layout: { biome: 'crypt', features: ['water', 'road'], levels: 3 },
    };
    const row = layoutRow(resolved(document, ['derive-layout']), undefined);
    expect(row).toMatchObject({ rooms: null, loops: null, levels: 3, size: null, flow: null, from: 'card' });
    expect(row?.biome).toBe('crypt');
    expect(row?.features).toContain('water');
    expect(row?.features).toContain('road');
    expect(row?.features).toContain('stairs');
  });

  it('refuses a standee, an unusable map and anything that is not a map or a tile', () => {
    const standee = card('example-dungeon-01');
    standee.map = { ...standee.map!, is_map: false };
    expect(layoutRow(resolved(standee, ['derive-layout']), undefined)).toBeNull();
    const unusable = card('example-dungeon-01');
    unusable.map = { ...unusable.map!, usable: 'no' };
    expect(layoutRow(resolved(unusable, ['derive-layout']), undefined)).toBeNull();
    const sprite = card('example-dungeon-01');
    sprite.kind = 'sprite';
    sprite.subkind = 'character';
    expect(layoutRow(resolved(sprite, ['derive-layout']), undefined)).toBeNull();
  });

  it('gives a tileset a grid from its tile size and its set as the type', () => {
    const document = card('example-dungeon-01');
    document.kind = 'sprite';
    document.subkind = 'tile';
    document.sprite = { drawn_view: 'topdown', tile_px: 16, sheet: { frame_w: 16, frame_h: 16, cols: 16, rows: 16 } };
    document.describe = { ...document.describe!, objects: ['wall', 'water'] };
    const row = layoutRow(resolved(document, ['in-game'], ['crypt']));
    expect(row).toMatchObject({ resource: 'tileset', type: null, biome: 'crypt', grid: 'square', cell_px: 16 });
    expect(row?.features).toEqual(['water']);
  });
});

describe('featuresOf', () => {
  it('keeps only the closed vocabulary and adds road for a road environment', () => {
    const document = card('example-dungeon-01');
    document.describe = { ...document.describe!, objects: ['pillar', 'banana', 'WATER'], keywords: ['well'] };
    expect(featuresOf(resolved(document, ['derive-layout'], ['road']))).toEqual(['pillar', 'road', 'water', 'well']);
  });
});

function indexOf(cards: ResolvedCard[]): CardIndex {
  return { version: 2, built: '', vocab: '2026-10-26', cards, collections: {}, errors: [] };
}

describe('buildMapIndex', () => {
  it('keeps only rows whose source grants derive-layout for a map and in-game for a tileset', () => {
    const allowed = resolved(card('example-dungeon-01'), ['derive-layout']);
    const hidden = resolved(card('example-dungeon-01'), ['vision-input']);
    const built = buildMapIndex(indexOf([allowed, hidden]), []);
    expect(built.maps.rows.map((row) => row.id)).toEqual([EXAMPLE_CARD]);
    expect(built.hidden).toBe(1);
  });

  it('prefers the spec the card points at when a card has more than one', () => {
    const document = resolved(card('example-dungeon-01'), ['derive-layout']);
    document.map = { ...document.map!, layout_spec: { id: SPEC.id, status: 'extracted' } };
    const other: LayoutSpecRow = {
      ...SPEC,
      id: 'layout:profantasy-cartographers-annual/example-dungeon-01@illustrative#9',
      tags: { ...SPEC.tags, computed: { ...SPEC.tags.computed, room_count: 2, size_class: 'small' } },
    };
    const built = buildMapIndex(indexOf([document]), [other, SPEC]);
    expect(built.maps.rows[0]?.rooms).toBe(7);
    expect(built.maps.rows[0]?.size).toBe('medium');
  });
});

describe('the map index file', () => {
  it('round-trips through disk and reads as empty when it has never been built', async () => {
    const root = libraryCopy();
    expect((await loadMapIndex(root)).rows).toEqual([]);
    const index = await buildIndex(root);
    const built = buildMapIndex(index, []);
    await writeMapIndex(root, built.maps);
    const loaded = await loadMapIndex(root);
    expect(loaded.vocab).toBe(index.vocab);
    expect(loaded.rows).toEqual(built.maps.rows);
  });
});
