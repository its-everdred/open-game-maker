import { lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  ATLAS_COLLECTION_ID,
  ATLAS_GENERATION,
  atlasCardById,
  atlasDatabasePath,
  atlasExtractedRoot,
  buildAtlasDatabase,
  buildIndex,
  materializeAtlasSprite,
  readAtlasRgba,
  searchAtlas,
  type CardIndex,
  type ResolvedCard,
} from '../src/index.js';
import { FIXTURE } from './helpers.js';

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

async function atlasFixture(): Promise<{ root: string; index: CardIndex }> {
  const root = mkdtempSync(join(tmpdir(), 'atlas-'));
  const extracted = atlasExtractedRoot(root);
  mkdirSync(extracted, { recursive: true });
  const tokenBytes = Buffer.alloc(2 * 256 * 2);
  for (let pixel = 0; pixel < 256; pixel += 1) {
    tokenBytes.writeUInt16LE(1, pixel * 2);
    tokenBytes.writeUInt16LE(2, (256 + pixel) * 2);
  }
  writeFileSync(join(extracted, 'tokens.npy'), npy('<u2', [2, 256], tokenBytes));
  writeFileSync(join(extracted, 'palette.npy'), npy('|u1', [3, 3], Buffer.from([0, 0, 0, 255, 0, 0, 0, 0, 255])));
  const index = await buildIndex(FIXTURE);
  const base = index.collections['t1:kenney-mini-dungeon@2.0']!;
  const collection: ResolvedCard = {
    ...base,
    id: ATLAS_COLLECTION_ID,
    title: 'Pixel Art Atlas',
    generation: ATLAS_GENERATION,
    collection_info: {
      ...base.collection_info!,
      vendor: 'angais',
      version: '1.4m',
      counts: { 'sprite/item': 2 },
    },
    resolved: {
      ...base.resolved,
      style_family: 'pixel-art',
      set: 'angais-pixel-art-atlas',
    },
  };
  index.collections[ATLAS_COLLECTION_ID] = collection;
  index.cards.push(collection);
  buildAtlasDatabase(atlasDatabasePath(root), {
    captions: ['red potion icon', 'blue sword icon'],
    subjects: ['potion icon', 'sword icon'],
    storageFiles: [
      { path: 'tokens.npy', sha256: `sha256:${'a'.repeat(64)}`, bytes: tokenBytes.length, format: 'npy' },
      { path: 'palette.npy', sha256: `sha256:${'b'.repeat(64)}`, bytes: 9, format: 'npy' },
    ],
  });
  return { root, index };
}

describe('Pixel Art Atlas', () => {
  it('finds a caption and subject from disk, includes the typed marker, and honors the AI filter', async () => {
    const { root, index } = await atlasFixture();
    const hits = searchAtlas(root, index, { words: ['red', 'potion'], limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: 't1:angais-pixel-art-atlas/sprites/0@1.4m',
      title: 'red potion icon',
      describe: { objects: ['potion-icon'], description: expect.stringContaining('Subject: potion icon') },
      generation: ATLAS_GENERATION,
    });
    expect(searchAtlas(root, index, { words: ['red', 'potion'], excludeAiGenerated: true })).toEqual([]);
  });

  it('reads only the selected NPY row and writes exact native, 2x, and 4x PNGs', async () => {
    const { root, index } = await atlasFixture();
    const rgba = readAtlasRgba(atlasExtractedRoot(root), 1);
    expect([...rgba.subarray(0, 4)]).toEqual([0, 0, 255, 255]);

    const card = searchAtlas(root, index, { words: ['blue', 'sword'] })[0]!;
    const materialized = await materializeAtlasSprite(root, card);
    expect(materialized?.files.map((file) => file.path)).toEqual([
      'rendered/1.png',
      'rendered/1@2x.png',
      'rendered/1@4x.png',
    ]);
    expect(await Promise.all(materialized!.files.map((file) => sharp(file.absolute).metadata()))).toMatchObject([
      { width: 16, height: 16 },
      { width: 32, height: 32 },
      { width: 64, height: 64 },
    ]);
    const native = await sharp(materialized!.files[0]!.absolute).raw().toBuffer();
    const four = await sharp(materialized!.files[2]!.absolute).raw().toBuffer();
    expect([...native.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    expect([...four.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  });

  it('matches only the literal Atlas version and safe integer row ids', async () => {
    const { root, index } = await atlasFixture();
    expect(atlasCardById(root, index, 't1:angais-pixel-art-atlas/sprites/0@1.4m')).toBeDefined();
    expect(atlasCardById(root, index, 't1:angais-pixel-art-atlas/sprites/00@1.4m')).toBeUndefined();
    expect(atlasCardById(root, index, 't1:angais-pixel-art-atlas/sprites/0@1x4m')).toBeUndefined();
    expect(atlasCardById(root, index, 't1:angais-pixel-art-atlas/sprites/999999999999999999999@1.4m')).toBeUndefined();
  });

  it('rejects oversized NPY headers before allocating their declared size', async () => {
    const { root } = await atlasFixture();
    const malformed = Buffer.alloc(12);
    malformed.write('\x93NUMPY', 0, 'latin1');
    malformed[6] = 2;
    malformed.writeUInt32LE(0xffff_ffff, 8);
    writeFileSync(join(atlasExtractedRoot(root), 'tokens.npy'), malformed);

    expect(() => readAtlasRgba(atlasExtractedRoot(root), 0)).toThrow('invalid NPY header length');
  });

  it('rejects an NPY header without an explicit storage order', async () => {
    const { root } = await atlasFixture();
    const path = join(atlasExtractedRoot(root), 'tokens.npy');
    const malformed = readFileSync(path);
    const key = malformed.indexOf('fortran_order', 0, 'latin1');
    expect(key).toBeGreaterThan(0);
    malformed.write('missing_order', key, 'latin1');
    writeFileSync(path, malformed);

    expect(() => readAtlasRgba(atlasExtractedRoot(root), 0)).toThrow('unsupported NPY header');
  });

  it('never follows a rendered directory or destination symlink outside the Atlas root', async () => {
    const first = await atlasFixture();
    const firstCard = searchAtlas(first.root, first.index, { words: ['red', 'potion'] })[0]!;
    const outsideDir = mkdtempSync(join(tmpdir(), 'atlas-outside-'));
    symlinkSync(outsideDir, join(atlasExtractedRoot(first.root), 'rendered'), 'dir');
    await expect(materializeAtlasSprite(first.root, firstCard)).rejects.toThrow('must not be a symbolic link');

    const second = await atlasFixture();
    const secondCard = searchAtlas(second.root, second.index, { words: ['red', 'potion'] })[0]!;
    const rendered = join(atlasExtractedRoot(second.root), 'rendered');
    mkdirSync(rendered);
    const outsideFile = join(outsideDir, 'untouched.png');
    writeFileSync(outsideFile, 'untouched');
    symlinkSync(outsideFile, join(rendered, '0.png'));
    await materializeAtlasSprite(second.root, secondCard);
    expect(readFileSync(outsideFile, 'utf8')).toBe('untouched');
    expect(lstatSync(join(rendered, '0.png')).isSymbolicLink()).toBe(false);
  });

  it('keeps the previous SQLite index when a replacement build fails', async () => {
    const { root, index } = await atlasFixture();
    expect(searchAtlas(root, index, { words: ['red', 'potion'] })).toHaveLength(1);

    expect(() =>
      buildAtlasDatabase(atlasDatabasePath(root), {
        captions: ['bad\ncaption'],
        subjects: ['potion'],
        storageFiles: [],
      }),
    ).toThrow('single-line text');
    expect(searchAtlas(root, index, { words: ['red', 'potion'] })).toHaveLength(1);
  });
});
