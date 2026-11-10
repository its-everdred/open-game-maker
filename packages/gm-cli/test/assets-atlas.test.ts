import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ATLAS_COLLECTION_ID,
  ATLAS_GENERATION,
  atlasDatabasePath,
  atlasExtractedRoot,
  buildAtlasDatabase,
} from '@ogm/asset-cards';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { gm, library, tempDir } from './helpers.js';

function npy(descr: string, shape: number[], bytes: Buffer): Buffer {
  const dictionary = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${shape.join(', ')},), }`;
  const prefix = 10;
  const padding = (16 - ((prefix + dictionary.length + 1) % 16)) % 16;
  const header = Buffer.from(`${dictionary}${' '.repeat(padding)}\n`, 'latin1');
  const preamble = Buffer.alloc(prefix);
  preamble.write('\x93NUMPY', 0, 'latin1');
  preamble[6] = 1;
  preamble[7] = 0;
  preamble.writeUInt16LE(header.length, 8);
  return Buffer.concat([preamble, header, bytes]);
}

function atlasLibrary(): string {
  const root = library();
  const packRoot = join(root, 'packs', 'angais-pixel-art-atlas');
  const extracted = atlasExtractedRoot(root);
  mkdirSync(extracted, { recursive: true });
  const tokens = Buffer.alloc(256 * 2, 0);
  for (let pixel = 0; pixel < 256; pixel += 1) tokens.writeUInt16LE(1, pixel * 2);
  writeFileSync(join(extracted, 'tokens.npy'), npy('<u2', [1, 256], tokens));
  writeFileSync(join(extracted, 'palette.npy'), npy('|u1', [2, 3], Buffer.from([0, 0, 0, 255, 0, 0])));
  writeFileSync(join(extracted, 'captions.json'), '["red potion wall icon"]\n');
  writeFileSync(join(extracted, 'objects.json'), '["potion icon"]\n');

  const base = JSON.parse(
    readFileSync(join(root, 'packs', 'kenney-mini-dungeon', 'collection.card.json'), 'utf8'),
  ) as Record<string, unknown> & {
    describe: Record<string, unknown>;
    collection_info: Record<string, unknown>;
  };
  const collection = {
    ...base,
    schema: 'ogm.asset-card/1.2',
    id: ATLAS_COLLECTION_ID,
    title: 'Pixel Art Atlas',
    generation: ATLAS_GENERATION,
    describe: { ...base.describe, style_family: 'pixel-art', set: 'angais-pixel-art-atlas' },
    collection_info: {
      ...base.collection_info,
      vendor: 'angais',
      version: '1.4m',
      counts: { 'sprite/item': 1 },
      pack_manifest: 'assets-local/packs/angais-pixel-art-atlas/pack.json',
    },
  };
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(join(packRoot, 'collection.card.json'), `${JSON.stringify(collection)}\n`);
  const subject = {
    schema: 'ogm.asset-card/1.2',
    vocab: base.vocab,
    id: 't1:angais-pixel-art-atlas/subjects/potion-icon-test@1.4m',
    card_type: 'asset',
    status: 'measured',
    title: 'potion icon',
    kind: 'sprite',
    subkind: 'item',
    collection: ATLAS_COLLECTION_ID,
    source: {
      files: [
        {
          path: 'tokens.npy',
          sha256: `sha256:${'a'.repeat(64)}`,
          bytes: tokens.length,
          format: 'npy',
          role: 'metadata',
        },
      ],
    },
    describe: { description: 'One subject group.', objects: ['potion-icon'], roles: ['icon'] },
    image: { width_px: 16, height_px: 16, has_alpha: true, pixel_art: true },
    sprite: { drawn_view: 'none', tile_px: 16, sheet_index: 0 },
    generation: ATLAS_GENERATION,
    provenance: base.provenance,
  };
  mkdirSync(join(packRoot, 'cards', 'subjects'), { recursive: true });
  writeFileSync(join(packRoot, 'cards', '.indexignore'), 'disk-backed search\n');
  writeFileSync(join(packRoot, 'cards', 'subjects', 'potion.card.json'), `${JSON.stringify(subject)}\n`);
  writeFileSync(
    join(packRoot, 'pack.json'),
    `${JSON.stringify({
      id: 'angais-pixel-art-atlas',
      vendor: 'angais',
      title: 'Pixel Art Atlas',
      category: '2d',
      license: 'CC0-1.0',
      license_source: '1.4m/originals/LICENSE',
      attribution: 'none required',
      source: { label: 'Angais/pixel-art-atlas-1.4m' },
      requires: [],
      current: '1.4m',
      versions: { '1.4m': { format: 'npy', extracted_files: 4, file_types: { npy: 2, json: 2 } } },
    })}\n`,
  );
  buildAtlasDatabase(atlasDatabasePath(root), {
    captions: ['red potion wall icon'],
    subjects: ['potion icon'],
    storageFiles: [
      { path: 'tokens.npy', sha256: `sha256:${'a'.repeat(64)}`, bytes: tokens.length, format: 'npy' },
      { path: 'palette.npy', sha256: `sha256:${'b'.repeat(64)}`, bytes: 6, format: 'npy' },
    ],
  });
  return root;
}

describe('gm assets Pixel Art Atlas', () => {
  it('searches caption and subject text, marks JSON and text, and filters generated assets', async () => {
    const assets = atlasLibrary();
    const options = { env: { OGM_ASSETS_ROOT: assets } };
    const text = await gm(['assets', 'search', 'red', 'potion'], options);
    expect(text.code).toBe(0);
    expect(text.out[0]).toContain('t1:angais-pixel-art-atlas/sprites/0@1.4m');
    expect(text.out[0]).toContain('[AI-generated: Krea 2 Turbo + pixel-art LoRA]');
    expect(text.out[0]).toContain('[subject: potion icon]');

    const json = await gm(['assets', 'search', 'red', 'potion', '--json'], options);
    expect(JSON.parse(json.out[0]!)).toMatchObject({
      title: 'red potion wall icon',
      describe: { objects: ['potion-icon'], description: expect.stringContaining('Subject: potion icon') },
      generation: ATLAS_GENERATION,
    });

    const filtered = await gm(['assets', 'search', 'red', 'potion', '--exclude-ai-generated'], options);
    expect(filtered.code).toBe(0);
    expect(filtered.out).toEqual([]);
  });

  it('keeps authored index matches visible beside Atlas rows', async () => {
    const assets = atlasLibrary();
    const result = await gm(['assets', 'search', 'wall', '--limit', '2'], {
      env: { OGM_ASSETS_ROOT: assets },
    });
    expect(result.code).toBe(0);
    expect(result.out).toHaveLength(2);
    expect(result.out.some((line) => line.includes('t1:kenney-mini-dungeon/wall@2.0'))).toBe(true);
    expect(result.out.some((line) => line.includes('t1:angais-pixel-art-atlas/sprites/0@1.4m'))).toBe(true);
  });

  it('automatically excludes generated assets for a game whose setting is off', async () => {
    const assets = atlasLibrary();
    const game = tempDir('gm-atlas-setting-');
    execFileSync('git', ['init', '-q'], { cwd: game });
    mkdirSync(join(game, '.gm', 'context'), { recursive: true });
    const nested = join(game, 'scenes', 'town');
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(game, '.gm', 'context', 'bundle.json'),
      JSON.stringify({ gameContext: { allowAiGeneratedAssets: false } }),
    );

    const result = await gm(['assets', 'search', 'red', 'potion'], {
      cwd: nested,
      env: { OGM_ASSETS_ROOT: assets },
    });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([]);

    const refused = await gm(
      ['assets', 'use', 't1:angais-pixel-art-atlas/sprites/0@1.4m', '--family', 'pixel-art', '--pov', 'topdown'],
      { cwd: nested, env: { OGM_ASSETS_ROOT: assets } },
    );
    expect(refused.code).toBe(2);
    expect(refused.err.join('\n')).toContain('ai-generated-disabled');
    expect(existsSync(join(game, 'assets.lock.json'))).toBe(false);
  });

  it('uses the host game preference when no job bundle exists', async () => {
    const assets = atlasLibrary();
    const game = tempDir('gm-atlas-host-setting-');
    execFileSync('git', ['init', '-q'], { cwd: game });
    mkdirSync(join(game, '.gm'), { recursive: true });
    writeFileSync(join(game, '.gm', 'game.json'), JSON.stringify({ allowAiGeneratedAssets: false }));

    const result = await gm(['assets', 'search', 'red', 'potion'], {
      cwd: game,
      env: { OGM_ASSETS_ROOT: assets },
    });

    expect(result).toMatchObject({ code: 0, out: [] });
    const refused = await gm(
      ['assets', 'use', 't1:angais-pixel-art-atlas/sprites/0@1.4m', '--family', 'pixel-art', '--pov', 'topdown'],
      { cwd: game, env: { OGM_ASSETS_ROOT: assets } },
    );
    expect(refused.code).toBe(2);
    expect(refused.err.join('\n')).toContain('ai-generated-disabled');
  });

  it('fails closed when a present game preference file is malformed', async () => {
    const assets = atlasLibrary();
    const game = tempDir('gm-atlas-bad-setting-');
    execFileSync('git', ['init', '-q'], { cwd: game });
    mkdirSync(join(game, '.gm', 'context'), { recursive: true });
    writeFileSync(join(game, '.gm', 'context', 'bundle.json'), '{ not json');

    const result = await gm(['assets', 'search', 'red', 'potion'], {
      cwd: game,
      env: { OGM_ASSETS_ROOT: assets },
    });

    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.err.join('\n')).toContain('is not valid game context JSON');
  });

  it('fails the game asset gate when an existing flagged asset remains after the setting is turned off', async () => {
    const assets = atlasLibrary();
    const game = tempDir('gm-atlas-setting-check-');
    execFileSync('git', ['init', '-q'], { cwd: game });
    const env = { OGM_ASSETS_ROOT: assets };
    const id = 't1:angais-pixel-art-atlas/sprites/0@1.4m';
    expect(
      (await gm(['assets', 'use', id, '--family', 'pixel-art', '--pov', 'topdown'], { cwd: game, env })).code,
    ).toBe(0);
    const lockPath = join(game, 'assets.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      assets: Array<{ meta?: { generation?: unknown } }>;
    };
    for (const asset of lock.assets) {
      if (asset.meta) delete asset.meta.generation;
    }
    writeFileSync(lockPath, JSON.stringify(lock));
    mkdirSync(join(game, '.gm', 'context'), { recursive: true });
    writeFileSync(
      join(game, '.gm', 'context', 'bundle.json'),
      JSON.stringify({ gameContext: { allowAiGeneratedAssets: false } }),
    );

    const checked = await gm(['check', 'assets'], { cwd: game, env });

    expect(checked.code).toBe(1);
    expect(checked.err.join('\n')).toContain(`${id}  ai-generated-disabled`);
  });

  it('inspects and previews a lazy Atlas row but refuses a subject summary as a sprite', async () => {
    const assets = atlasLibrary();
    const game = tempDir('gm-atlas-inspect-');
    const env = { OGM_ASSETS_ROOT: assets };
    const id = 't1:angais-pixel-art-atlas/sprites/0@1.4m';

    expect((await gm(['assets', 'info', id], { cwd: game, env })).out[0]).toContain(`${id}  sprite/item`);
    expect((await gm(['assets', 'why', id], { cwd: game, env })).out[0]).toContain(`${id}  CC0-1.0`);
    const out = join(game, 'atlas-sheet.png');
    expect((await gm(['assets', 'sheet', id, '--out', out], { cwd: game, env })).code).toBe(0);
    expect((await sharp(out).metadata()).width).toBe(256);

    const refused = await gm(
      [
        'assets',
        'use',
        't1:angais-pixel-art-atlas/subjects/potion-icon-test@1.4m',
        '--family',
        'pixel-art',
        '--pov',
        'topdown',
      ],
      { cwd: game, env },
    );
    expect(refused.code).toBe(2);
    expect(refused.err.join('\n')).toContain('subject summaries cannot be used');
    expect(existsSync(join(game, 'assets.lock.json'))).toBe(false);
  });

  it('uses one row as native, 2x and 4x PNGs with marker, license, set and credits', async () => {
    const assets = atlasLibrary();
    const game = tempDir('gm-atlas-game-');
    const result = await gm(
      ['assets', 'use', 't1:angais-pixel-art-atlas/sprites/0@1.4m', '--family', 'pixel-art', '--pov', 'topdown'],
      { cwd: game, env: { OGM_ASSETS_ROOT: assets } },
    );
    expect(result).toMatchObject({ code: 0, err: [] });
    const lock = JSON.parse(readFileSync(join(game, 'assets.lock.json'), 'utf8')) as {
      minor: number;
      assets: Array<Record<string, unknown>>;
    };
    expect(lock.assets[0]).toMatchObject({
      id: 't1:angais-pixel-art-atlas/sprites/0@1.4m',
      path: 'assets/sprite/angais-pixel-art-atlas/0.png',
      source: 'vendored',
      license: 'CC0-1.0',
      set: 'angais-pixel-art-atlas',
      meta: { generation: ATLAS_GENERATION },
    });
    expect(lock.assets[0]!.files).toMatchObject([
      { path: 'assets/sprite/angais-pixel-art-atlas/0@2x.png' },
      { path: 'assets/sprite/angais-pixel-art-atlas/0@4x.png' },
    ]);
    for (const name of ['0.png', '0@2x.png', '0@4x.png']) {
      expect(existsSync(join(game, 'assets', 'sprite', 'angais-pixel-art-atlas', name))).toBe(true);
    }
    expect(await sharp(join(game, 'assets/sprite/angais-pixel-art-atlas/0.png')).metadata()).toMatchObject({
      width: 16,
      height: 16,
    });
    const pixel = await sharp(join(game, 'assets/sprite/angais-pixel-art-atlas/0.png')).raw().toBuffer();
    expect([...pixel.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(readFileSync(join(game, 'CREDITS.md'), 'utf8')).toContain('[AI-generated: Krea 2 Turbo + pixel-art LoRA]');
    expect((await gm(['check', 'assets'], { cwd: game, env: { OGM_ASSETS_ROOT: assets } })).code).toBe(0);
    expect(
      (
        await gm(['build', 'assets', '--tier', 'low', '--budget', 'low'], {
          cwd: game,
          env: { OGM_ASSETS_ROOT: assets },
        })
      ).code,
    ).toBe(0);
    const manifest = JSON.parse(readFileSync(join(game, 'public/assets/manifest.json'), 'utf8')) as {
      assets: Record<string, { meta?: unknown }>;
    };
    expect(manifest.assets['t1:angais-pixel-art-atlas/sprites/0@1.4m']?.meta).toMatchObject({
      generation: ATLAS_GENERATION,
    });
  });
});
