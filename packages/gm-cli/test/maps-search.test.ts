import { createHash } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { MapLayoutSpec } from '@ogm/contracts';

import { parseQuery } from '../src/maps/specs.js';
import { gm } from './helpers.js';
import { EXAMPLE_SPEC, mapsLibrary } from './library-rights.js';

const EXAMPLE_MAP = 't1:profantasy-cartographers-annual/example-dungeon-01@illustrative';
const DRIFTED = 'inspiration/profantasy-cartographers-annual/layouts/drifted.layout.json';
const CC0_MAP = 't1:cc0-dungeon-maps/roads-of-the-old-crypt@v1';
const TILESET = 't1:kenney-mini-dungeon/tiles/dungeon-tilesheet@2.0';

async function index(root = mapsLibrary()) {
  return gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: root } });
}

async function search(argv: string[], root?: string) {
  const library = root ?? mapsLibrary();
  const built = await gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: library } });
  expect(built.code).toBe(0);
  return gm(['maps', 'search', ...argv], { env: { OGM_ASSETS_ROOT: library } });
}

const ids = (result: { out: string[] }) => result.out.map((line) => line.split('  ')[0]);

function layoutCachePath(root: string, cardId = CC0_MAP): string {
  const key = createHash('sha256').update(cardId).digest('hex');
  return join(root, 'index', 'map-layouts', `${key}.json`);
}

function editCachedLayout(root: string, edit: (layout: MapLayoutSpec) => void): void {
  const path = layoutCachePath(root);
  const layout = JSON.parse(readFileSync(path, 'utf8')) as MapLayoutSpec;
  edit(layout);
  writeFileSync(path, JSON.stringify(layout));
}

async function expectCacheFailure(root: string): Promise<void> {
  const result = await gm(['maps', 'info', CC0_MAP, '--json'], { env: { OGM_ASSETS_ROOT: root } });
  expect(result.code).toBe(1);
  expect(result.err).toContainEqual(expect.stringContaining('rebuild with gm maps index'));
}

describe('parseQuery', () => {
  it('reads the C3 §10 example query', () => {
    expect(parseQuery(['small crypt 3-5 rooms one loop secret door'])).toEqual({
      sizeWord: 'small',
      types: ['crypt'],
      rooms: [3, 5],
      loops: { min: 1, exact: false },
      secrets: 1,
      words: [],
    });
  });

  it('lets flags override words and keeps unknown words for ranking', () => {
    expect(parseQuery(['two loops pillared'], { rooms: '4', loops: 1, size: 'small', type: 'cave' })).toEqual({
      rooms: [4, 4],
      loops: { min: 1, exact: true },
      size: 'small',
      types: ['cave'],
      words: ['pillared'],
    });
  });
});

describe('gm maps index', () => {
  it('writes one layout row per map and tileset resource an agent may build from, and hides the rest', async () => {
    const result = await index();
    expect(result.code).toBe(0);
    expect(result.out).toContainEqual(expect.stringContaining('2 maps, 1 tilesets (2 with a layout spec)'));
    expect(result.out).toContainEqual(expect.stringContaining('hidden: 1 resources'));
    expect(result.err).toContainEqual(expect.stringContaining(`invalid: ${DRIFTED}: tags.computed.loop_count is 4`));
  });

  it('carries the card layout columns and never a preview path or a description', async () => {
    const library = mapsLibrary();
    await gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: library } });
    const result = await gm(['maps', 'search', '--json', '--biome', 'crypt', '--limit', '100'], {
      env: { OGM_ASSETS_ROOT: library },
    });
    const rows = result.out.map((line) => JSON.parse(line) as Record<string, unknown>);
    const card = rows.find((row) => row.id === CC0_MAP);
    expect(card).toMatchObject({ resource: 'map', biome: 'crypt', scale: 'battlemap', levels: 2, grid: 'square' });
    expect(card?.cell_px).toBe(32);
    expect(card?.features).toEqual(['road', 'stairs', 'tomb', 'water']);
    expect(result.out.join('\n')).not.toContain('previews');
    expect(result.out.join('\n')).not.toContain('A crypt under a crossroads');
  });
});

describe('gm maps info', () => {
  it('returns the validated graph for a searchable inspiration map without exposing a file or preview path', async () => {
    const library = mapsLibrary();
    await gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: library } });

    const result = await gm(['maps', 'info', CC0_MAP, '--json'], { env: { OGM_ASSETS_ROOT: library } });

    expect(result.code).toBe(0);
    const spec = JSON.parse(result.out[0]!) as Record<string, unknown>;
    expect(spec).toMatchObject({
      id: 'layout:cc0-dungeon-maps/small-crypt@v1#1',
      source: { card_id: CC0_MAP, required_use: 'derive-layout' },
      tags: { computed: { room_count: 4, connection_count: 5, loop_count: 1, secret_count: 1 } },
    });
    expect(result.out.join('\n')).not.toMatch(/(?:preview|\.png|\/layouts\/)/);
  });

  it('reads only the derived graph after indexing, without rescanning source cards or layouts', async () => {
    const library = mapsLibrary();
    await gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: library } });
    renameSync(join(library, 'inspiration'), join(library, 'source-offline'));

    const result = await gm(['maps', 'info', CC0_MAP, '--json'], { env: { OGM_ASSETS_ROOT: library } });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!)).toMatchObject({
      id: 'layout:cc0-dungeon-maps/small-crypt@v1#1',
      source: { card_id: CC0_MAP, required_use: 'derive-layout' },
    });
  });

  it('refuses a tileset, a rights-hidden map, and an unknown id', async () => {
    const library = mapsLibrary();
    await gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: library } });

    for (const id of [TILESET, 't1:vision-only-maps/example-dungeon-01@illustrative', 't1:missing/map@v1']) {
      const result = await gm(['maps', 'info', id], { env: { OGM_ASSETS_ROOT: library } });
      expect(result.code).toBe(2);
      expect(result.err).toContainEqual(expect.stringContaining('is not in the searchable inspiration index'));
    }
  });

  it('rejects a stale layout revision and a graph whose computed metrics drifted', async () => {
    const cases: Array<(layout: MapLayoutSpec) => void> = [
      (layout) => {
        layout.id = 'layout:cc0-dungeon-maps/small-crypt@v1#2';
      },
      (layout) => {
        layout.tags.computed.loop_count += 1;
      },
    ];
    for (const edit of cases) {
      const library = mapsLibrary();
      await gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: library } });
      editCachedLayout(library, edit);
      await expectCacheFailure(library);
    }
  });

  it('rejects image-only, wrong-card, malformed, and missing cached layouts', async () => {
    const cases: Array<(root: string) => void> = [
      (root) =>
        editCachedLayout(root, (layout) => {
          layout.extraction.status = 'image-only';
          layout.rooms = [];
          layout.connections = [];
          layout.features = [];
          Object.assign(layout.tags.computed, {
            room_count: 0,
            connection_count: 0,
            loop_count: 0,
            entrance_count: 0,
            dead_end_count: 0,
            secret_count: 0,
            level_change_count: 0,
            longest_path_rooms: 0,
            total_area_cells: 0,
          });
        }),
      (root) => editCachedLayout(root, (layout) => (layout.source.card_id = 't1:somewhere/else@v1')),
      (root) => writeFileSync(layoutCachePath(root), '{not json'),
      (root) => unlinkSync(layoutCachePath(root)),
    ];
    for (const corrupt of cases) {
      const library = mapsLibrary();
      await gm(['maps', 'index'], { env: { OGM_ASSETS_ROOT: library } });
      corrupt(library);
      await expectCacheFailure(library);
    }
  });
});

describe('gm maps search', () => {
  it('answers the C3 §10 example: small crypt 3-5 rooms one loop secret door', async () => {
    const result = await search(['small crypt 3-5 rooms one loop secret door']);
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      `${CC0_MAP}  crypt  crypt  battlemap  square@32  4/1/1  small  loop  road,stairs,tomb,water`,
    ]);
    expect(result.err.join('\n')).not.toContain('vision-only-maps');
  });

  it('answers a biome and feature question across maps and tilesets', async () => {
    const tilesets = await search(['--feature', 'water', '--tilesets']);
    expect(ids(tilesets)).toEqual([TILESET]);
    expect(tilesets.out[0]).toContain('square@16');
    const crypt = await search(['--biome', 'crypt', '--feature', 'road']);
    expect(ids(crypt)).toEqual([CC0_MAP]);
  });

  it('filters by scale and grid, and prints a facet line so an agent narrows instead of paging', async () => {
    const result = await search(['--scale', 'battlemap', '--grid', 'square', '--limit', '100']);
    expect(ids(result)).toEqual([CC0_MAP, TILESET]);
    expect(result.err).toContainEqual(expect.stringMatching(/^\d+ of \d+ \(map \d+, tileset \d+\)/));
  });

  it('joins a layout spec onto its card, and excludes its 7 rooms from --rooms 3-5', async () => {
    expect(ids(await search(['--rooms', '3-5', '--limit', '100']))).toEqual([CC0_MAP]);
    const seven = await search(['--rooms', '6-15', '--limit', '100']);
    expect(ids(seven)).toEqual([EXAMPLE_MAP]);
    expect(seven.out[0]).toContain('dungeon  dungeon  -  square@50  7/1/1  medium  hub-and-spoke');
  });

  it('applies --loops exactly and --size as a hard filter', async () => {
    expect((await search(['--loops', '2'])).out).toEqual([]);
    expect(ids(await search(['--size', 'small']))).toEqual([CC0_MAP]);
  });

  it('prints no matches and exits 0 for a place nothing has', async () => {
    const result = await search(['--biome', 'space-station']);
    expect(result.code).toBe(0);
    expect(result.out).toEqual([]);
    expect(result.err).toContain('no matches');
  });

  it('refuses an unknown size, scale, grid and flow, and a malformed room range', async () => {
    expect((await search(['--size', 'enormous'])).code).toBe(2);
    expect((await search(['--scale', 'galactic'])).code).toBe(2);
    expect((await search(['--grid', 'triangular'])).code).toBe(2);
    expect((await search(['--flow', 'spiral'])).code).toBe(2);
    expect((await search(['--rooms', 'many'])).code).toBe(2);
  });

  it('asks for the index instead of scanning the library when none is built', async () => {
    const library = mapsLibrary();
    const result = await gm(['maps', 'search', 'crypt'], { env: { OGM_ASSETS_ROOT: library } });
    expect(result.code).toBe(1);
    expect(result.err).toContainEqual(expect.stringContaining('run `gm maps index`'));
  });
});
