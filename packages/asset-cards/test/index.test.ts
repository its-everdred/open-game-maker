import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  CARD_INDEX_VERSION,
  INDEX_PATH,
  buildIndex,
  buildPackIndex,
  isStale,
  loadIndex,
  resolve,
  writeIndex,
} from '../src/index.js';
import { FIXTURE, libraryCopy } from './helpers.js';

const ORC = 't1:kenney-mini-dungeon/character-orc@2.0';

describe('buildIndex', () => {
  it('indexes collections stored in the shared sets directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-set-index-'));
    mkdirSync(join(root, 'sets'), { recursive: true });
    cpSync(join(FIXTURE, 'packs/kenney-mini-dungeon'), join(root, 'sets/kenney-mini-dungeon'), { recursive: true });
    expect((await buildIndex(root)).cards.some((card) => card.id === ORC)).toBe(true);
    expect((await buildPackIndex(root, ['kenney-mini-dungeon'])).cards.some((card) => card.id === ORC)).toBe(true);
  });

  it('rebuilds old cached indexes that predate set discovery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-set-cache-'));
    mkdirSync(join(root, 'sets'), { recursive: true });
    cpSync(join(FIXTURE, 'packs/kenney-mini-dungeon'), join(root, 'sets/kenney-mini-dungeon'), { recursive: true });
    mkdirSync(join(root, 'index'));
    writeFileSync(
      join(root, INDEX_PATH),
      JSON.stringify({ version: 2, built: '', vocab: '', cards: [], collections: {}, errors: [] }),
    );
    expect((await loadIndex(root)).cards.some((card) => card.id === ORC)).toBe(true);
  });
  it('indexes every valid card and lists the invalid ones without failing', async () => {
    const index = await buildIndex(FIXTURE);
    expect(index.cards).toHaveLength(19);
    expect(Object.keys(index.collections)).toHaveLength(6);
    expect(index.errors.map((error) => error.path).sort()).toEqual([
      'packs/kenney-mini-dungeon/cards/broken-no-source.card.json',
      'packs/kenney-mini-dungeon/cards/broken-status.card.json',
    ]);
  });

  it('indexes only the named pack without walking the rest of the library', async () => {
    const index = await buildPackIndex(FIXTURE, ['kenney-mini-dungeon']);

    expect(index.cards.length).toBeGreaterThan(1);
    expect(index.cards.every((card) => card.id.includes('kenney-mini-dungeon'))).toBe(true);
    expect(Object.keys(index.collections)).toEqual(['t1:kenney-mini-dungeon@2.0']);
    expect(index.errors.map(({ path }) => path)).toEqual([
      'packs/kenney-mini-dungeon/cards/broken-no-source.card.json',
      'packs/kenney-mini-dungeon/cards/broken-status.card.json',
    ]);
  });

  it('keeps the previous on-disk index when the command encounters an invalid card', () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-index-command-'));
    mkdirSync(join(root, 'packs', 'broken', 'cards'), { recursive: true });
    mkdirSync(join(root, 'index'));
    writeFileSync(join(root, 'packs', 'broken', 'cards', 'bad.card.json'), '{not json');
    const indexPath = join(root, INDEX_PATH);
    writeFileSync(indexPath, '{"previous":true}\n');

    const script = fileURLToPath(new URL('../scripts/build-index.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refusing to replace the asset index: 1 invalid card(s)');
    expect(readFileSync(indexPath, 'utf8')).toBe('{"previous":true}\n');
  }, 30_000);

  it("gives an asset without rights its collection's rights, licence and family, marked by: collection", async () => {
    const index = await buildIndex(FIXTURE);
    const orc = index.cards.find((card) => card.id === ORC);
    expect(orc?.rights).toBeUndefined();
    expect(orc?.resolved.rights.uses).toEqual([
      'derive-layout',
      'in-game',
      'placeholder',
      'style-reference',
      'vision-input',
    ]);
    expect(orc?.resolved.license).toBe('CC0-1.0');
    expect(orc?.resolved.style_family).toBe('chunky-low-poly');
    expect(orc?.resolved.pov_fit).toEqual(['iso', 'topdown', 'follow', 'orbit']);
    expect(orc?.resolved.provenance).toMatchObject({
      rights: { by: 'collection' },
      license: { by: 'collection' },
      'describe.style_family': { by: 'collection' },
    });
    // the asset's own environments win over the collection's
    expect(orc?.resolved.environments).toEqual(['dungeon', 'cave', 'camp']);
    expect(orc?.resolved.provenance['describe.environments']).toBeUndefined();
  });

  it('inherits the collection compatibility set with provenance', () => {
    type Card = Parameters<typeof resolve>[0];
    const collection = JSON.parse(
      readFileSync(join(FIXTURE, 'packs/kenney-mini-dungeon/collection.card.json'), 'utf8'),
    ) as Card;
    const asset = JSON.parse(
      readFileSync(join(FIXTURE, 'packs/kenney-mini-dungeon/cards/character-orc.card.json'), 'utf8'),
    ) as Card;
    collection.describe = { ...collection.describe, set: 'kenney-mini-3d' };
    const resolved = resolve(asset, { [collection.id]: collection });
    expect(resolved.resolved.set).toBe('kenney-mini-3d');
    expect(resolved.resolved.provenance['describe.set']).toEqual({ by: 'collection' });
  });

  it('inherits the collection generation marker onto the item card with provenance', () => {
    type Card = Parameters<typeof resolve>[0];
    const collection = JSON.parse(
      readFileSync(join(FIXTURE, 'packs/kenney-mini-dungeon/collection.card.json'), 'utf8'),
    ) as Card & { generation?: { method: 'ai'; tool: string } };
    const asset = JSON.parse(
      readFileSync(join(FIXTURE, 'packs/kenney-mini-dungeon/cards/character-orc.card.json'), 'utf8'),
    ) as Card;
    collection.generation = { method: 'ai', tool: 'test generator' };
    const resolved = resolve(asset, { [collection.id]: collection });
    expect(resolved.generation).toEqual({ method: 'ai', tool: 'test generator' });
    expect(resolved.resolved.provenance.generation).toEqual({ by: 'collection' });
  });

  it('never widens: an asset basis granting in-game inside a vision-input-only collection stays vision-input', async () => {
    const index = await buildIndex(FIXTURE);
    const drums = index.cards.find((card) => card.id === 't1:sidetrax-pack-60-battle/war-drums@v1');
    expect(drums?.rights?.uses).toContain('in-game');
    expect(drums?.resolved.rights).toEqual({ uses: ['vision-input'], audience: 'private', redistribution: 'none' });
  });

  it('gives an asset with no collection card and no rights no uses at all', async () => {
    const index = await buildIndex(FIXTURE);
    const flame = index.cards.find((card) => card.id === 't1:kenney-particle-pack/flame-01@1.1');
    expect(flame?.resolved.rights.uses).toEqual([]);
  });
});

describe('loadIndex', () => {
  it('writes the index when missing, reuses it when fresh and rebuilds when a card is newer', async () => {
    const root = libraryCopy();
    expect(await isStale(root)).toBe(true);
    const first = await loadIndex(root);
    expect(existsSync(join(root, INDEX_PATH))).toBe(true);
    expect(await isStale(root)).toBe(false);

    // a fresh index is read back, not rebuilt
    const marked = { ...first, vocab: 'from-disk' };
    await writeIndex(root, marked);
    expect((await loadIndex(root)).vocab).toBe('from-disk');

    const future = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'packs/kenney-mini-dungeon/cards/wall.card.json'), future, future);
    expect(await isStale(root)).toBe(true);
    expect((await loadIndex(root)).vocab).not.toBe('from-disk');
    expect(JSON.parse(readFileSync(join(root, INDEX_PATH), 'utf8')).vocab).not.toBe('from-disk');
  });

  it('rebuilds an older cache format even when the cache file is newer than every card', async () => {
    const root = libraryCopy();
    const current = await loadIndex(root);
    const old = { ...current, version: 1, vocab: 'old-cache' };
    writeFileSync(join(root, INDEX_PATH), `${JSON.stringify(old)}\n`);
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(root, INDEX_PATH), future, future);

    expect(await isStale(root)).toBe(true);
    const rebuilt = await loadIndex(root);
    expect(rebuilt.version).toBe(CARD_INDEX_VERSION);
    expect(rebuilt.vocab).not.toBe('old-cache');
  });

  it('serves the rebuilt index when the stale index directory is read-only', async () => {
    const root = libraryCopy();
    const cards = join(root, 'packs/kenney-mini-dungeon/cards');
    const newCard = join(cards, 'new-worker-card.card.json');
    const template = JSON.parse(readFileSync(join(cards, 'wall.card.json'), 'utf8')) as Record<string, unknown>;
    template.id = 't1:kenney-mini-dungeon/new-worker-card@1.0';
    writeFileSync(newCard, JSON.stringify(template));
    const existing = await loadIndex(root);
    const indexFile = join(root, INDEX_PATH);
    const future = new Date(Date.now() + 60_000);
    utimesSync(newCard, future, future);
    const indexDir = join(root, 'index');
    chmodSync(indexDir, 0o555);

    try {
      const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
      const rebuilt = await loadIndex(root);
      expect(rebuilt.cards.some((card) => card.id === template.id)).toBe(true);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0]?.[0]).toContain('using a fresh in-memory index');
      expect(JSON.parse(readFileSync(indexFile, 'utf8')).cards).toEqual(existing.cards);
      warning.mockRestore();
    } finally {
      chmodSync(indexDir, 0o755);
    }
  });

  it('writes the index through a same-directory temporary file and leaves no temporary files', async () => {
    const root = libraryCopy();
    const index = await buildIndex(root);
    const destination = await writeIndex(root, index);

    expect(JSON.parse(readFileSync(destination, 'utf8')).cards).toHaveLength(index.cards.length);
    expect(readdirSync(join(root, 'index'))).toEqual(['cards.index.json']);
  });

  it('keeps card trees marked indexignore out of the general index', async () => {
    const root = libraryCopy();
    const cards = join(root, 'packs/kenney-mini-dungeon/cards');
    writeFileSync(join(cards, '.indexignore'), 'disk-backed search\n');

    const index = await buildIndex(root);
    expect(index.collections).toHaveProperty('t1:kenney-mini-dungeon@2.0');
    expect(index.cards.some((card) => card.id === ORC)).toBe(false);
  });

  it('invalidates a cache when a card tree becomes indexignored', async () => {
    const root = libraryCopy();
    const current = await loadIndex(root);
    expect(current.cards.some((card) => card.id === ORC)).toBe(true);

    const cards = join(root, 'packs/kenney-mini-dungeon/cards');
    writeFileSync(join(cards, '.indexignore'), 'disk-backed search\n');
    const future = new Date(Date.now() + 60_000);
    utimesSync(cards, future, future);

    expect(await isStale(root)).toBe(true);
    expect((await loadIndex(root)).cards.some((card) => card.id === ORC)).toBe(false);
  });
});
