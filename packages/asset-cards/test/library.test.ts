import { describe, expect, it } from 'vitest';

import { editorLibrary, packLabel, tagOf } from '../src/library.js';
import type { ResolvedCard } from '../src/types.js';

type Extra = Partial<Omit<ResolvedCard, 'resolved'>> & { resolved?: Partial<ResolvedCard['resolved']> };

function card(id: string, title: string, extra: Extra = {}): ResolvedCard {
  const { resolved, ...rest } = extra;
  return {
    schema: 'ogm.asset-card/1.0',
    vocab: '2026-10-27',
    id,
    card_type: 'asset',
    status: 'measured',
    title,
    kind: 'sprite',
    subkind: 'tile',
    collection: id.replace(/\/.*@/, '@'),
    describe: {},
    provenance: {},
    previews: { thumb: `private/previews/${title.replaceAll(' ', '')}-thumb.webp` },
    resolved: {
      license: 'LicenseRef-test',
      rights: { uses: ['in-game'], audience: 'private', redistribution: 'in-build' },
      provenance: {},
      set: 'iso-set',
      ...resolved,
    },
    ...rest,
  } as ResolvedCard;
}

const rural = (name: string, title: string, extra?: Extra) => card(`t1:rural-tiles/tiles/${name}@1`, title, extra);

function build(cards: ResolvedCard[], packs: string[] = [], allowAiGenerated = true) {
  return editorLibrary(
    {
      cards,
      collections: {
        't1:rural-tiles@1': card('t1:rural-tiles@1', '2D HD Rural Tileset v1.1 (Smallscaleint)', {
          card_type: 'collection',
        }),
      },
    },
    { set: 'iso-set', packs, allowAiGenerated },
  );
}

describe('editorLibrary', () => {
  it('gives fences their own kind chip, so a creator reaches them in one tap from the open sheet', () => {
    const { library } = build([
      rural('fence-a1', 'Fence A1'),
      rural('wall-b2', 'Wall B2'),
      rural('tree-a1', 'Tree A1'),
    ]);

    expect(library.groups.map((group) => group.id)).toEqual(['fences', 'walls', 'nature']);
    expect(library.items.find((item) => item.label === 'Fence A1')).toMatchObject({ group: 'fences', tag: 'Fence' });
  });

  it('files wall vines under nature, not walls, and lets the title outrank the folder name', () => {
    const withFarm = build(
      [
        rural('wallflora-a1', 'WallFlora A1'),
        card('t1:farm/single-files/fences/topsoil-1@1', 'Topsoil Corner 1', { resolved: { set: undefined } }),
        card('t1:farm/single-files/fences/rod-rope-1@1', 'Rod Rope 1', { resolved: { set: undefined } }),
      ],
      ['farm'],
    ).library;

    expect(Object.fromEntries(withFarm.items.map((item) => [item.label, item.group]))).toEqual({
      'WallFlora A1': 'nature',
      'Topsoil Corner 1': 'ground',
      'Rod Rope 1': 'fences',
    });
  });

  it("offers the game's whole set plus the packs it already uses, and nothing else", () => {
    const { library } = build(
      [
        rural('fence-a1', 'Fence A1'),
        card('t1:farm/props/crate@1', 'Crate', { resolved: { set: undefined } }),
        card('t1:other-pack/props/barrel@1', 'Barrel', { resolved: { set: 'other-set' } }),
      ],
      ['farm'],
    );

    expect(library.items.map((item) => item.pack).sort()).toEqual(['farm', 'rural-tiles']);
    expect(library.packs).toEqual([
      { id: 'farm', label: 'farm' },
      { id: 'rural-tiles', label: 'Rural' },
    ]);
  });

  it("lists the game's own set before other packs within a kind, so its pieces are the first a creator sees", () => {
    const { library } = build(
      [
        card('t1:farm/fences/apple-fence@1', 'Apple Fence', { resolved: { set: undefined } }),
        rural('fence-b1', 'Fence B1'),
        rural('fence-a1', 'Fence A1'),
      ],
      ['farm'],
    );

    expect(library.items.map((item) => item.label)).toEqual(['Fence A1', 'Fence B1', 'Apple Fence']);
  });

  it('leaves out what cannot be placed or shown: audio, sheets with no thumbnail, rejected, not for in-game use', () => {
    const { library, thumbs } = build([
      rural('fence-a1', 'Fence A1'),
      rural('song', 'Song', { kind: 'audio' }),
      rural('zombie-sheet', 'Zombie 1', {
        previews: {},
        image: { width_px: 1920, height_px: 1024, has_alpha: true },
        source: { files: [{ path: 'Zombie 1.png', sha256: 'sha256:00', bytes: 1, format: 'png', role: 'primary' }] },
      }),
      rural('bad', 'Bad', { status: 'rejected' }),
      rural('ref', 'Reference', {
        resolved: { rights: { uses: ['style-reference'], audience: 'private', redistribution: 'none' } },
      }),
    ]);

    expect(library.items.map((item) => item.label)).toEqual(['Fence A1']);
    expect([...thumbs.keys()]).toEqual(['t1:rural-tiles/tiles/fence-a1@1']);
  });

  it('points a piece without a rendered thumbnail at its own small image, and never outside the pack', () => {
    const file = (path: string) => ({
      previews: {},
      image: { width_px: 32, height_px: 32, has_alpha: true },
      source: { files: [{ path, sha256: 'sha256:00', bytes: 1, format: 'png', role: 'primary' as const }] },
    });
    const { thumbs } = build([
      rural('crate', 'Crate', file('Props/Crate.png')),
      rural('evil', 'Evil', file('../x.png')),
    ]);

    expect(Object.fromEntries(thumbs)).toEqual({
      't1:rural-tiles/tiles/crate@1': 'packs/rural-tiles/1/extracted/Props/Crate.png',
    });
  });

  it('keeps AI-made pieces out of games that do not allow them', () => {
    const ai = rural('ai-tree', 'Tree Z1', { generation: { method: 'ai' } } as Extra);
    expect(build([ai], [], false).library.items).toEqual([]);
    expect(build([ai], [], true).library.items).toHaveLength(1);
  });

  it('buckets model footprints by size, and gives flat sprites none', () => {
    const model = (name: string, span: number) =>
      card(`t1:kit/props/${name}@1`, name, {
        kind: 'model',
        resolved: { set: undefined },
        geometry: { bounds_m: { min: [0, 0, 0], max: [span, 1, span / 2] } },
      } as Extra);
    const { library } = build(
      [model('pebble', 0.5), model('cart', 2), model('barn', 6), rural('fence-a1', 'Fence A1')],
      ['kit'],
    );

    expect(Object.fromEntries(library.items.map((item) => [item.label, item.size]))).toEqual({
      pebble: 'small',
      cart: 'medium',
      barn: 'large',
      'Fence A1': undefined,
    });
  });
});

describe('tagOf and packLabel', () => {
  it('names the family a piece belongs to, so finer chips group siblings', () => {
    expect(['Wall F17', 'ZombieMale3', 'Pine Blue 2', 'Misc B24', '12695'].map(tagOf)).toEqual([
      'Wall',
      'Zombie',
      'Pine',
      'Misc',
      'Other',
    ]);
  });

  it('drops vendor, version and format words from pack titles', () => {
    expect(packLabel('2D HD Zombie Rural Tileset (Smallscaleint)')).toBe('Zombie Rural');
    expect(packLabel('Fantasy tileset - 2D Isometric V1.1 (Smallscaleint)')).toBe('Fantasy');
    expect(packLabel('Modern Farm (Limezu)')).toBe('Modern Farm');
  });
});
