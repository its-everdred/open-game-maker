import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '@ogm/config';
import { beforeAll, describe, expect, it } from 'vitest';

import { recompute } from '../src/families-coverage.js';
import {
  StyleFamiliesSchema,
  StyleFamilySchema,
  buildIndex,
  computeCoverage,
  familyFor,
  isCreationChoice,
  loadFamilies,
  packsOfFamily,
  setFor,
  writeFamilies,
  type CardIndex,
  type StyleFamily,
} from '../src/index.js';
import { FIXTURE } from './helpers.js';

const CATALOG_IDS = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/catalog-ids.json', import.meta.url)), 'utf8'),
) as string[];
const SEEDS = fileURLToPath(new URL('../../../scripts/assets/data/collection_tags.jsonl', import.meta.url));
const ASSETS_ROOT = loadEnv('gm', { OGM_ASSETS_ROOT: { kind: 'path', required: false } }).OGM_ASSETS_ROOT;
const HOST_CATALOG = ASSETS_ROOT ? join(ASSETS_ROOT, 'catalog.json') : undefined;
const SMALLSCALEINT_PACKS = [
  'smallscaleint-2d-animals-mega-pack-1',
  'smallscaleint-2d-character-knight',
  'smallscaleint-2d-character-pack-1',
  'smallscaleint-2d-character-pack-2',
  'smallscaleint-2d-demons-topdown-assetpack',
  'smallscaleint-2d-desert-fantasy-tileset',
  'smallscaleint-2d-hd-barbarian-pack-1',
  'smallscaleint-2d-hd-character-knight',
  'smallscaleint-2d-hd-character-pack-1',
  'smallscaleint-2d-hd-enemy-pack-1',
  'smallscaleint-2d-hd-undead-pack-1',
  'smallscaleint-2d-hd-zombie-individual-sprites',
  'smallscaleint-2d-hd-zombie-interior-tiles',
  'smallscaleint-2d-hd-zombie-pack-1',
  'smallscaleint-2d-hd-zombie-rural-tileset',
  'smallscaleint-2d-orcs-and-goblins-topdown',
  'smallscaleint-2d-projectiles-character-pack-1',
  'smallscaleint-2d-projectiles-character-pack-2',
  'smallscaleint-2d-topdown-archer-character',
  'smallscaleint-2d-zombie-pack-2-top-down',
  'smallscaleint-fantasy-tileset-2d-isometric',
  'smallscaleint-free-character-16-bit-thug-outlined',
  'smallscaleint-free-character-hd-survivor-w-bike',
  'smallscaleint-knight-demo-character',
  'smallscaleint-projectiles-2d-hd-character-pack-1',
  'smallscaleint-projectiles-barbarian-pack-hd',
].sort();

const family = (overrides: Partial<StyleFamily>): StyleFamily => ({ ...loadFamilies()[0], ...overrides });

let index: CardIndex;
beforeAll(async () => {
  index = await buildIndex(FIXTURE);
});

describe('style-families.json', () => {
  it('holds exactly the seven C2 families, Synty ones not offered at creation', () => {
    expect(loadFamilies().map((f) => f.id)).toEqual([
      'chunky-low-poly',
      'detailed-low-poly',
      'simple-low-poly',
      'pixel-art',
      'flat-cartoon',
      'isometric-2d',
      'sketch',
    ]);
    expect(isCreationChoice('detailed-low-poly')).toBe(false);
    expect(isCreationChoice('simple-low-poly')).toBe(false);
    expect(isCreationChoice('chunky-low-poly')).toBe(true);
    expect(isCreationChoice('any')).toBe(false);
  });

  it('names only packs the catalog holds (checked-in id list)', () => {
    const known = new Set(CATALOG_IDS);
    expect(
      loadFamilies()
        .flatMap(packsOfFamily)
        .filter((id) => !known.has(id)),
    ).toEqual([]);
  });

  it.skipIf(!HOST_CATALOG || !existsSync(HOST_CATALOG))('names only packs this host catalog holds', () => {
    const catalog = JSON.parse(readFileSync(HOST_CATALOG as string, 'utf8')) as { packs: { id: string }[] };
    const known = new Set(catalog.packs.map((pack) => pack.id));
    expect(
      loadFamilies()
        .flatMap(packsOfFamily)
        .filter((id) => !known.has(id)),
    ).toEqual([]);
  });

  it('maps a pack to its family', () => {
    expect(familyFor('kenney-tiny-dungeon')).toBe('pixel-art');
    expect(familyFor('kenney-mini-dungeon')).toBe('chunky-low-poly');
    expect(familyFor('kenney-music-loops')).toBeUndefined();
  });

  it('groups compatible packs into trait-defined sets instead of vendor catalogues', () => {
    const kaykit = setFor('kaykit-adventurers');
    expect(kaykit).toMatchObject({
      id: 'kaykit',
      vendors: ['kaykit'],
      traits: expect.objectContaining({
        polycount_band: 'mobile-friendly low-poly, measured per model',
        texture_style: 'flat palette atlases with clean colour blocks',
      }),
    });
    expect(kaykit?.packs).toHaveLength(23);
    expect(kaykit?.packs.find((pack) => pack.id === 'kaykit-adventurers')?.compatible_with).toEqual([
      'kenney-animated-characters-bundle',
      'synty-polygon-viking-realm',
    ]);
    expect(kaykit?.packs.find((pack) => pack.id === 'kaykit-prototype-bits')?.compatible_with).toEqual([
      'kenney-prototype-kit',
      'synty-polygon-prototype',
    ]);
    expect(kaykit?.packs.find((pack) => pack.id === 'kaykit-skeletons')?.compatible_with).toEqual([
      'quaternius-ultimate-monsters',
    ]);
    expect(setFor('kenney-tiny-dungeon')?.id).toBe('kenney-tiny');
    expect(setFor('angais-pixel-art-atlas')).toMatchObject({
      id: 'angais-pixel-art-atlas',
      vendors: ['angais'],
      traits: expect.objectContaining({ tile_grid: '16x16 px', palette: 'varied per subject' }),
    });
    expect(setFor('kenney-tiny-town')?.id).toBe('kenney-tiny');
    expect(setFor('kenney-pixel-platformer')?.id).toBe('kenney-pixel-platformer');
    expect(setFor('limezu-modern-interiors')).toMatchObject({
      id: 'limezu-modern',
      vendors: ['limezu'],
      traits: expect.objectContaining({ tile_grid: '16x16 px', perspective: 'topdown' }),
    });
    expect(setFor('limezu-modern-interiors')?.packs).toContainEqual(
      expect.objectContaining({ id: 'limezu-modern-interiors' }),
    );
    expect(loadFamilies().flatMap((f) => f.sets)).toHaveLength(11);
  });

  it('registers every imported SmallScaleInt pack in one measured isometric set', () => {
    const set = loadFamilies()
      .find((f) => f.id === 'isometric-2d')!
      .sets.find((candidate) => candidate.id === 'smallscaleint');
    expect(set?.packs.map((pack) => pack.id).sort()).toEqual(SMALLSCALEINT_PACKS);
    expect(set?.picker_families).toEqual(['pixel-art']);
    expect(set?.traits).toMatchObject({ perspective: 'isometric 2:1' });
    expect(set?.previews).toEqual({
      specimen: 'sets/smallscaleint/specimen.png',
      trailer: 'sets/smallscaleint/trailer.mp4',
      diorama: {
        fantasy: 'sets/smallscaleint/diorama.fantasy.256.png',
        'modern-zombie': 'sets/smallscaleint/diorama.modern-zombie.256.png',
        creatures: 'sets/smallscaleint/diorama.creatures.256.png',
      },
      loop: {
        fantasy: 'sets/smallscaleint/diorama.fantasy.256.gif',
        'modern-zombie': 'sets/smallscaleint/diorama.modern-zombie.256.gif',
        creatures: 'sets/smallscaleint/diorama.creatures.256.gif',
      },
    });
  });

  // The seeds (filename words, no images) call Kenney's 3D kits simple-low-poly; C2 §2 and this file call them
  // chunky-low-poly and keep simple-low-poly for Synty SIMPLE. Any other seed/file split is a curation error.
  it('agrees with the collection_tags.jsonl seeds except the known Kenney 3D split', () => {
    const seeds = readFileSync(SEEDS, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: string; sf: string });
    const unexpected = seeds
      .map(({ id, sf }) => ({ id, seed: sf, file: familyFor(id) }))
      .filter(({ seed, file }) => file && file !== seed)
      .filter(
        ({ id, seed, file }) => !(id.startsWith('kenney-') && seed === 'simple-low-poly' && file === 'chunky-low-poly'),
      );
    expect(unexpected).toEqual([]);
  });
});

describe('StyleFamilySchema', () => {
  it('refuses a creation choice without props, and accepts it once offered no longer', () => {
    const coverage = { characters: true, environment: true, props: false, ui: true, sfx: true, music: true };
    expect(StyleFamilySchema.safeParse(family({ coverage, creation_choice: true })).success).toBe(false);
    expect(StyleFamilySchema.safeParse(family({ coverage, creation_choice: false })).success).toBe(true);
  });

  it('refuses a pack listed in two families and a missing family', () => {
    const families = loadFamilies();
    const twice = families.map((f, i) =>
      i === 1 ? { ...f, packs: { ...f.packs, extras: [...f.packs.extras, 'kenney-mini-dungeon'] } } : f,
    );
    expect(StyleFamiliesSchema.safeParse(twice).success).toBe(false);
    expect(StyleFamiliesSchema.safeParse(families.slice(1)).success).toBe(false);
  });

  it('refuses duplicate set ids and sets without measured traits', () => {
    const families = loadFamilies();
    const duplicate = families.map((f, i) =>
      i === 0 ? { ...f, sets: [{ ...families.find((other) => other.id === 'pixel-art')!.sets[0]! }] } : f,
    );
    expect(StyleFamiliesSchema.safeParse(duplicate).success).toBe(false);
    const pixel = families.find((f) => f.id === 'pixel-art')!;
    const unmeasured = families.map((f) =>
      f.id === 'pixel-art'
        ? { ...f, sets: [{ ...pixel.sets[0]!, traits: { judgment: 'looked compatible' } }, ...pixel.sets.slice(1)] }
        : f,
    );
    expect(StyleFamiliesSchema.safeParse(unmeasured).success).toBe(false);
  });

  it('refuses set previews when a world is missing its still or loop', () => {
    const families = structuredClone(loadFamilies());
    const previews = families
      .find((entry) => entry.id === 'isometric-2d')!
      .sets.find((set) => set.id === 'smallscaleint')!.previews!;
    delete previews.loop.creatures;
    expect(StyleFamiliesSchema.safeParse(families).success).toBe(false);
  });

  it('refuses traversal segments in set preview paths', () => {
    const families = structuredClone(loadFamilies());
    families
      .find((entry) => entry.id === 'isometric-2d')!
      .sets.find((set) => set.id === 'smallscaleint')!.previews!.specimen = 'sets/../private.png';

    expect(StyleFamiliesSchema.safeParse(families).success).toBe(false);
  });

  it('refuses traversal segments in a set trailer path', () => {
    const families = structuredClone(loadFamilies());
    families
      .find((entry) => entry.id === 'isometric-2d')!
      .sets.find((set) => set.id === 'smallscaleint')!.previews!.trailer = 'sets/../private.mp4';

    expect(StyleFamiliesSchema.safeParse(families).success).toBe(false);
  });

  it('refuses unknown picker-family aliases', () => {
    const families = structuredClone(loadFamilies());
    Object.assign(
      families.find((entry) => entry.id === 'isometric-2d')!.sets.find((set) => set.id === 'smallscaleint')!,
      { picker_families: ['photoreal'] },
    );

    expect(StyleFamiliesSchema.safeParse(families).success).toBe(false);
  });

  it('allows an advisory compatibility link to a known pack outside the set', () => {
    const families = loadFamilies();
    const linked = families.map((f) =>
      f.id === 'pixel-art'
        ? {
            ...f,
            sets: f.sets.map((set) =>
              set.id === 'kenney-tiny'
                ? {
                    ...set,
                    packs: set.packs.map((pack, index) =>
                      index === 0 ? { ...pack, compatible_with: ['kenney-pixel-platformer'] } : pack,
                    ),
                  }
                : set,
            ),
          }
        : f,
    );
    expect(StyleFamiliesSchema.safeParse(linked).success).toBe(true);
  });

  it('refuses advisory compatibility links to the same or an unknown pack', () => {
    const self = loadFamilies()
      .find((f) => f.id === 'pixel-art')!
      .sets.find((set) => set.id === 'kenney-tiny')!.packs[0]!.id;
    const withLink = (target: string) =>
      loadFamilies().map((f) =>
        f.id === 'pixel-art'
          ? {
              ...f,
              sets: f.sets.map((set) =>
                set.id === 'kenney-tiny'
                  ? {
                      ...set,
                      packs: set.packs.map((pack, index) =>
                        index === 0 ? { ...pack, compatible_with: [target] } : pack,
                      ),
                    }
                  : set,
              ),
            }
          : f,
      );
    expect(StyleFamiliesSchema.safeParse(withLink(self)).success).toBe(false);
    expect(StyleFamiliesSchema.safeParse(withLink('missing-pack')).success).toBe(false);
  });
});

describe('computeCoverage', () => {
  const miniDungeon = family({ packs: { primary: ['kenney-mini-dungeon'], extras: [] } });
  const assetsOnly = () => ({ ...index, cards: index.cards.filter((card) => card.card_type === 'asset') });

  it('measures what the pack cards hold; any-family in-game music supplies music', () => {
    expect(computeCoverage(assetsOnly(), miniDungeon)).toEqual({
      characters: true,
      environment: true,
      props: false,
      ui: false,
      // every fixture SFX card lacks in-game rights (vision-input only, quarantined, or no collection)
      sfx: false,
      music: true,
    });
  });

  it('marks characters false when the only character card is removed', () => {
    const cards = assetsOnly().cards.filter((card) => card.id !== 't1:kenney-mini-dungeon/character-orc@2.0');
    expect(computeCoverage({ ...index, cards }, miniDungeon).characters).toBe(false);
  });

  it('ignores quarantined and rejected cards, and cards in a quarantined collection', () => {
    const orc = 't1:kenney-mini-dungeon/character-orc@2.0';
    const only = (status: 'quarantined' | 'rejected') => ({
      ...index,
      cards: assetsOnly().cards.map((card) => (card.id === orc ? { ...card, status } : card)),
    });
    expect(computeCoverage(only('quarantined'), miniDungeon).characters).toBe(false);
    expect(computeCoverage(only('rejected'), miniDungeon).characters).toBe(false);
    const collection = index.collections['t1:kenney-mini-dungeon@2.0'];
    const quarantined = {
      ...assetsOnly(),
      collections: { ...index.collections, [collection.id]: { ...collection, status: 'quarantined' as const } },
    };
    expect(computeCoverage(quarantined, miniDungeon).characters).toBe(false);
  });

  it('reads a collection card counts and curated family_coverage', () => {
    expect(computeCoverage(index, miniDungeon).props).toBe(true);
    const collections = index.cards.filter((card) => card.card_type === 'collection');
    const torchPack = family({ packs: { primary: ['synty-polygon-goblin-war-camp'], extras: [] } });
    expect(computeCoverage({ ...index, cards: collections }, torchPack).props).toBe(false);
    expect(computeCoverage(index, torchPack).props).toBe(true);
  });

  it('counts any-family cards only for sfx/music, and only cards with in-game rights', () => {
    const inGame = (card: CardIndex['cards'][number]) => ({
      ...card,
      resolved: { ...card.resolved, rights: { ...card.resolved.rights, uses: ['in-game' as const] } },
    });
    const tiny = family({ packs: { primary: ['kenney-tiny-dungeon'], extras: [] } });
    const denied = {
      ...index,
      cards: index.cards.map((card) =>
        card.id.includes('kenney-tiny-dungeon')
          ? { ...card, resolved: { ...card.resolved, rights: { ...card.resolved.rights, uses: [] } } }
          : card,
      ),
    };
    expect(computeCoverage(denied, tiny).characters).toBe(false);
    const granted = { ...index, cards: index.cards.map(inGame) };
    expect(computeCoverage(granted, tiny)).toEqual({
      characters: true,
      environment: false,
      props: false,
      ui: false,
      sfx: true,
      music: true,
    });
  });
});

describe('families:coverage recompute', () => {
  it('fails a creation choice whose packs lost props', () => {
    const offered = family({
      id: 'pixel-art',
      packs: { primary: ['kenney-tiny-dungeon'], extras: [] },
      creation_choice: true,
    });
    const families = loadFamilies().map((f) => (f.id === 'pixel-art' ? offered : f));
    const { families: next, failures } = recompute(index, families);
    expect(next.find((f) => f.id === 'pixel-art')?.coverage.props).toBe(false);
    expect(failures.some((line) => line.startsWith('pixel-art: creation_choice'))).toBe(true);
  });

  it('validates before writing a family file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'families-write-')), 'style-families.json');
    writeFamilies(loadFamilies(), path);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(loadFamilies());

    expect(() => writeFamilies(loadFamilies().slice(1), path)).toThrow(/chunky-low-poly must appear once/);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(loadFamilies());
  });
});
