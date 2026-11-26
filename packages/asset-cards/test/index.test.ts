import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
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

  it('persists sound-set cards and retains each variation’s rights', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sound-set-index-'));
    const cards = join(root, 'sets/fantasy/cards');
    mkdirSync(cards, { recursive: true });
    const soundSet = {
      schema: 'ogm.sound-set-card/1.0',
      id: 'fantasy/hit',
      set_id: 'fantasy',
      category_id: 'hit',
      title: 'Hit',
      intent: 'A hit',
      variation_count: 1,
      preview: {
        path: 'previews/hit.mp3',
        order: ['hit-01'],
        excerpt_seconds: 1,
        gap_seconds: 0,
        audition: { status: 'pending-operator' },
      },
      variations: [
        {
          id: 'hit-01',
          pack_id: 'test',
          pack_title: 'Test',
          pack_version: '1',
          source_path: 'hit.wav',
          collection_card: null,
          license: 'CC0-1.0',
          rights_uses: ['in-game'],
          sha256: `sha256:${'a'.repeat(64)}`,
          bytes: 1,
          audio: { channels: 1, codec: 'pcm', duration_seconds: 1, sample_rate: 48000 },
          audition: { status: 'pending-operator' },
        },
      ],
      provenance: {},
    };
    writeFileSync(join(cards, 'hit.card.json'), JSON.stringify(soundSet));
    const index = await buildIndex(root);
    expect(index.errors).toEqual([]);
    expect(index.soundSets).toEqual([soundSet]);
    await writeIndex(root, index);
    expect(JSON.parse(readFileSync(join(root, INDEX_PATH), 'utf8')).soundSets).toEqual([soundSet]);
    soundSet.variation_count = 2;
    writeFileSync(join(cards, 'hit.card.json'), JSON.stringify(soundSet));
    expect((await buildIndex(root)).errors).toHaveLength(1);
  });

  it('fails the build when a card cannot be read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-index-unreadable-'));
    const cards = join(root, 'packs/broken/cards');
    mkdirSync(cards, { recursive: true });
    symlinkSync(join(root, 'missing'), join(cards, 'unreadable.card.json'));
    await expect(buildIndex(root)).rejects.toThrow();
  });

  it('denies asset rights when their collection is invalid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-index-parent-'));
    const pack = join(root, 'packs/kenney-mini-dungeon');
    cpSync(join(FIXTURE, 'packs/kenney-mini-dungeon'), pack, { recursive: true });
    const collectionPath = join(pack, 'collection.card.json');
    const collection = JSON.parse(readFileSync(collectionPath, 'utf8'));
    const assetPath = join(pack, 'cards/character-orc.card.json');
    const asset = JSON.parse(readFileSync(assetPath, 'utf8'));
    asset.rights = collection.rights;
    writeFileSync(assetPath, JSON.stringify(asset));
    writeFileSync(collectionPath, '{}');
    const index = await buildIndex(root);
    expect(index.cards.find((card) => card.id === ORC)?.resolved.rights.uses).toEqual([]);
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

  it('finds the workspace asset root by default when run from the package', () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-index-default-'));
    const pkg = join(root, 'packages/asset-cards');
    mkdirSync(join(pkg, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'assets-local/packs'), { recursive: true });
    cpSync(fileURLToPath(new URL('../scripts/build-index.mjs', import.meta.url)), join(pkg, 'scripts/build-index.mjs'));
    symlinkSync(fileURLToPath(new URL('../dist', import.meta.url)), join(pkg, 'dist'), 'dir');
    const result = spawnSync(process.execPath, [join(pkg, 'scripts/build-index.mjs')], { cwd: pkg, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'assets-local', INDEX_PATH))).toBe(true);
  }, 30_000);

  it('writes valid cards and warns when the command encounters an invalid card', () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-index-command-'));
    mkdirSync(join(root, 'packs', 'broken', 'cards'), { recursive: true });
    cpSync(join(FIXTURE, 'packs/kenney-mini-dungeon'), join(root, 'packs/kenney-mini-dungeon'), { recursive: true });
    mkdirSync(join(root, 'index'));
    writeFileSync(join(root, 'packs', 'broken', 'cards', 'bad.card.json'), '{not json');
    const indexPath = join(root, INDEX_PATH);
    writeFileSync(indexPath, '{"previous":true}\n');

    const script = fileURLToPath(new URL('../scripts/build-index.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('WARNING: skipped invalid card packs/broken/cards/bad.card.json');
    expect(result.stderr).toContain('invalid card(s) skipped');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(index.cards.some((card: { id: string }) => card.id === ORC)).toBe(true);
    expect(index.errors.some((error: { path: string }) => error.path === 'packs/broken/cards/bad.card.json')).toBe(
      true,
    );
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
