import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { lstat, mkdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import sharp from 'sharp';

import type { AssetCard } from '@ogm/contracts';

import { passes } from './search.js';
import type { CardIndex, ResolvedCard, SearchQuery } from './types.js';

export const ATLAS_PACK = 'angais-pixel-art-atlas';
export const ATLAS_VERSION = '1.4m';
export const ATLAS_COLLECTION_ID = `t1:${ATLAS_PACK}@${ATLAS_VERSION}`;
export const ATLAS_GENERATION = { method: 'ai' as const, tool: 'Krea 2 Turbo + pixel-art LoRA' };

const WIDTH = 16;
const HEIGHT = 16;
const PIXELS = WIDTH * HEIGHT;
const TOKEN_BYTES = PIXELS * 2;
const DB_FILE = 'atlas.sqlite';
const MAX_NPY_HEADER_BYTES = 1024 * 1024;
const MAX_PALETTE_ROWS = 65_536;
const BIDI_CONTROLS = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

function unsafeTextCharacter(character: string): boolean {
  const code = character.codePointAt(0)!;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || BIDI_CONTROLS.has(code);
}

export type AtlasRow = { rowId: number; caption: string; subject: string };
export type AtlasStorageFile = { path: string; sha256: `sha256:${string}`; bytes: number; format: string };
export type AtlasMaterialized = { card: ResolvedCard; files: Array<{ path: string; absolute: string }> };

type NpyInfo = {
  dataOffset: number;
  descr: string;
  fortran: boolean;
  shape: number[];
};

export function atlasExtractedRoot(assetsRoot: string): string {
  return join(assetsRoot, 'packs', ATLAS_PACK, ATLAS_VERSION, 'extracted');
}

export function atlasDatabasePath(assetsRoot: string): string {
  return join(atlasExtractedRoot(assetsRoot), DB_FILE);
}

/** Atlas metadata crosses terminal, Markdown and card-schema boundaries, so it must remain short single-line text. */
export function assertAtlasText(value: string, field: string): string {
  if (value.length === 0 || value.length > 120 || [...value].some(unsafeTextCharacter)) {
    throw new Error(`Atlas ${field} must be 1..120 characters of single-line text`);
  }
  return value;
}

/** Card vocabulary tag for an exact dataset subject; the exact human label remains in the description and FTS row. */
export function atlasSubjectTag(subject: string): string {
  const slug = subject
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const prefixed = /^[a-z]/.test(slug) ? slug : `subject-${slug || 'unknown'}`;
  return prefixed.slice(0, 40).replace(/-$/, '');
}

function npyInfo(path: string): NpyInfo {
  const fd = openSync(path, 'r');
  try {
    const fileSize = statSync(path).size;
    const prefix = Buffer.alloc(12);
    const read = readSync(fd, prefix, 0, prefix.length, 0);
    if (read < 10 || prefix.subarray(0, 6).toString('latin1') !== '\x93NUMPY') {
      throw new Error(`${basename(path)} is not an NPY file`);
    }
    const major = prefix[6]!;
    const lengthBytes = major === 1 ? 2 : major === 2 || major === 3 ? 4 : 0;
    if (lengthBytes === 0) throw new Error(`${basename(path)} uses unsupported NPY version ${major}`);
    const headerLength = lengthBytes === 2 ? prefix.readUInt16LE(8) : prefix.readUInt32LE(8);
    const headerOffset = 8 + lengthBytes;
    if (headerLength > MAX_NPY_HEADER_BYTES || headerOffset + headerLength > fileSize) {
      throw new Error(`${basename(path)} has an invalid NPY header length`);
    }
    const header = Buffer.alloc(headerLength);
    if (readSync(fd, header, 0, headerLength, headerOffset) !== headerLength) {
      throw new Error(`${basename(path)} has a truncated NPY header`);
    }
    const text = header.toString('latin1');
    const descr = /['"]descr['"]\s*:\s*['"]([^'"]+)['"]/.exec(text)?.[1];
    const fortranValue = /['"]fortran_order['"]\s*:\s*(True|False)/.exec(text)?.[1];
    const shapeText = /['"]shape['"]\s*:\s*\(([^)]*)\)/.exec(text)?.[1];
    const shape = shapeText
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number);
    if (!descr || !fortranValue || !shape || shape.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${basename(path)} has an unsupported NPY header`);
    }
    return { dataOffset: headerOffset + headerLength, descr, fortran: fortranValue === 'True', shape };
  } finally {
    closeSync(fd);
  }
}

function checkedNpy(path: string, descr: string, tailShape: number[], itemBytes: number): NpyInfo {
  const info = npyInfo(path);
  if (info.descr !== descr || info.fortran || info.shape.slice(1).join(',') !== tailShape.join(',')) {
    throw new Error(
      `${basename(path)} must be C-order ${descr} with shape (rows, ${tailShape.join(', ')}), got ${info.descr} ${JSON.stringify(info.shape)}`,
    );
  }
  let items = 1;
  for (const value of info.shape) {
    if (value !== 0 && items > Number.MAX_SAFE_INTEGER / value) {
      throw new Error(`${basename(path)} has an unsafe NPY shape`);
    }
    items *= value;
  }
  if (items > Number.MAX_SAFE_INTEGER / itemBytes) throw new Error(`${basename(path)} has an unsafe NPY size`);
  const expected = info.dataOffset + items * itemBytes;
  if (!Number.isSafeInteger(expected)) throw new Error(`${basename(path)} has an unsafe NPY size`);
  if (statSync(path).size !== expected) throw new Error(`${basename(path)} size does not match its NPY header`);
  return info;
}

function readPayload(path: string, offset: number, bytes: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const payload = Buffer.alloc(bytes);
    if (readSync(fd, payload, 0, bytes, offset) !== bytes) throw new Error(`${basename(path)} has a truncated payload`);
    return payload;
  } finally {
    closeSync(fd);
  }
}

/** Reusable row reader for contact-sheet batches; it holds one fd and the 12KB palette, never the token array. */
export class AtlasArrayReader {
  readonly rowCount: number;
  readonly #tokens: NpyInfo;
  readonly #palette: NpyInfo;
  readonly #paletteBytes: Buffer;
  readonly #fd: number;

  constructor(extractedRoot: string) {
    const tokensPath = join(extractedRoot, 'tokens.npy');
    const palettePath = join(extractedRoot, 'palette.npy');
    this.#tokens = checkedNpy(tokensPath, '<u2', [PIXELS], 2);
    this.#palette = checkedNpy(palettePath, '|u1', [3], 1);
    if (this.#palette.shape[0]! > MAX_PALETTE_ROWS) throw new Error('palette.npy has too many rows for uint16 tokens');
    this.#paletteBytes = readPayload(palettePath, this.#palette.dataOffset, this.#palette.shape[0]! * 3);
    this.#fd = openSync(tokensPath, 'r');
    this.rowCount = this.#tokens.shape[0]!;
  }

  readRgba(rowId: number): Buffer {
    if (!Number.isInteger(rowId) || rowId < 0 || rowId >= this.rowCount) {
      throw new Error(`Atlas row ${rowId} is outside 0..${this.rowCount - 1}`);
    }
    const tokenBytes = Buffer.alloc(TOKEN_BYTES);
    if (readSync(this.#fd, tokenBytes, 0, TOKEN_BYTES, this.#tokens.dataOffset + rowId * TOKEN_BYTES) !== TOKEN_BYTES) {
      throw new Error(`Atlas row ${rowId} is truncated`);
    }
    const rgba = Buffer.alloc(PIXELS * 4);
    for (let pixel = 0; pixel < PIXELS; pixel += 1) {
      const token = tokenBytes.readUInt16LE(pixel * 2);
      if (token >= this.#palette.shape[0]!) throw new Error(`Atlas row ${rowId} names missing palette index ${token}`);
      rgba[pixel * 4] = this.#paletteBytes[token * 3]!;
      rgba[pixel * 4 + 1] = this.#paletteBytes[token * 3 + 1]!;
      rgba[pixel * 4 + 2] = this.#paletteBytes[token * 3 + 2]!;
      rgba[pixel * 4 + 3] = token === 0 ? 0 : 255;
    }
    return rgba;
  }

  close(): void {
    closeSync(this.#fd);
  }
}

/** Read one 16x16 row without mapping or loading the full 1.4M-row array. */
export function readAtlasRgba(extractedRoot: string, rowId: number): Buffer {
  const reader = new AtlasArrayReader(extractedRoot);
  try {
    return reader.readRgba(rowId);
  } finally {
    reader.close();
  }
}

function quotedFts(words: string[]): string {
  return words
    .flatMap((word) =>
      word
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    )
    .map((word) => `"${word.replaceAll('"', '""')}"`)
    .join(' AND ');
}

function openAtlas(assetsRoot: string): DatabaseSync | null {
  const path = atlasDatabasePath(assetsRoot);
  return existsSync(path) ? new DatabaseSync(path, { readOnly: true }) : null;
}

function storageFiles(db: DatabaseSync): AtlasStorageFile[] {
  const row = db.prepare("SELECT value FROM metadata WHERE name = 'storage_files'").get() as
    { value: string } | undefined;
  return row ? (JSON.parse(row.value) as AtlasStorageFile[]) : [];
}

function atlasCard(row: AtlasRow, collection: ResolvedCard, files: AtlasStorageFile[]): ResolvedCard {
  const caption = assertAtlasText(row.caption, `caption for row ${row.rowId}`);
  const subject = assertAtlasText(row.subject, `subject for row ${row.rowId}`);
  const [firstFile, ...otherFiles] = files.map((file) => ({ ...file, role: 'metadata' as const }));
  if (!firstFile) throw new Error('Atlas index has no storage file metadata');
  const sourceFiles: NonNullable<AssetCard['source']>['files'] = [firstFile, ...otherFiles];
  const card: AssetCard = {
    schema: 'ogm.asset-card/1.2',
    vocab: collection.vocab,
    id: `t1:${ATLAS_PACK}/sprites/${row.rowId}@${ATLAS_VERSION}`,
    card_type: 'asset',
    status: 'measured',
    title: caption,
    kind: 'sprite',
    subkind: 'item',
    collection: ATLAS_COLLECTION_ID,
    source: { files: sourceFiles },
    describe: {
      description: `Subject: ${subject}. Caption: ${caption}`,
      objects: [atlasSubjectTag(subject)],
      roles: ['icon'],
    },
    image: { width_px: WIDTH, height_px: HEIGHT, has_alpha: true, pixel_art: true },
    sprite: { drawn_view: 'none', tile_px: WIDTH, sheet_index: row.rowId },
    generation: ATLAS_GENERATION,
    provenance: {
      '*': {
        by: 'code',
        tool: 'ogm-atlas-index@1',
        at: '2026-11-09T00:00:00Z',
        input: `Atlas row ${row.rowId}`,
      },
      generation: {
        by: 'collection',
        at: '2026-11-09T00:00:00Z',
        input: 'collection generation marker',
      },
    },
  };
  return {
    ...card,
    resolved: {
      ...collection.resolved,
      provenance: { ...collection.resolved.provenance, generation: { by: 'collection' } },
    },
  };
}

/** Query only the disk FTS index; the 1.4M captions and subjects never enter process memory. */
export function searchAtlas(assetsRoot: string, index: CardIndex, query: SearchQuery): ResolvedCard[] {
  if (query.excludeAiGenerated || (query.words?.length ?? 0) === 0) return [];
  const collection = index.collections[ATLAS_COLLECTION_ID];
  if (!collection || !passes(index, collection, query)) return [];
  const match = quotedFts(query.words ?? []);
  if (!match) return [];
  const db = openAtlas(assetsRoot);
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        'SELECT s.row_id AS rowId, s.caption, s.subject FROM sprites_fts JOIN sprites s ON s.row_id = sprites_fts.rowid WHERE sprites_fts MATCH ? ORDER BY rank, s.row_id LIMIT ?',
      )
      .all(match, query.limit ?? 10) as AtlasRow[];
    const files = storageFiles(db);
    return rows.map((row) => atlasCard(row, collection, files)).filter((card) => passes(index, card, query));
  } finally {
    db.close();
  }
}

function atlasRowId(id: string): number | undefined {
  const prefix = `t1:${ATLAS_PACK}/sprites/`;
  const suffix = `@${ATLAS_VERSION}`;
  if (!id.startsWith(prefix) || !id.endsWith(suffix)) return undefined;
  const rowText = id.slice(prefix.length, -suffix.length);
  if (!/^\d+$/.test(rowText)) return undefined;
  const rowId = Number(rowText);
  return Number.isSafeInteger(rowId) && String(rowId) === rowText ? rowId : undefined;
}

export function atlasCardById(assetsRoot: string, index: CardIndex, id: string): ResolvedCard | undefined {
  const collection = index.collections[ATLAS_COLLECTION_ID];
  const rowId = atlasRowId(id);
  if (!collection || rowId === undefined) return undefined;
  const db = openAtlas(assetsRoot);
  if (!db) return undefined;
  try {
    const row = db.prepare('SELECT row_id AS rowId, caption, subject FROM sprites WHERE row_id = ?').get(rowId) as
      AtlasRow | undefined;
    return row ? atlasCard(row, collection, storageFiles(db)) : undefined;
  } finally {
    db.close();
  }
}

export function isAtlasSpriteId(id: string): boolean {
  return atlasRowId(id) !== undefined;
}

/** Resolve either an ordinary indexed card or one lazy Atlas row card. */
export function cardById(assetsRoot: string, index: CardIndex, id: string): ResolvedCard | undefined {
  return index.cards.find((card) => card.id === id) ?? atlasCardById(assetsRoot, index, id);
}

async function fileRecord(path: string): Promise<AtlasStorageFile> {
  const bytes = (await stat(path)).size;
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  return { path, sha256: `sha256:${sha256}`, bytes, format: 'png' };
}

/** Materialize just one selected row as native pixels plus nearest-neighbour engine upscales. */
export async function materializeAtlasSprite(
  assetsRoot: string,
  card: ResolvedCard,
): Promise<AtlasMaterialized | undefined> {
  const rowId = atlasRowId(card.id);
  if (rowId === undefined || card.sprite?.sheet_index !== rowId) return undefined;
  const root = atlasExtractedRoot(assetsRoot);
  const rendered = join(root, 'rendered');
  await mkdir(rendered, { recursive: true });
  if ((await lstat(rendered)).isSymbolicLink()) throw new Error('Atlas rendered directory must not be a symbolic link');
  const [realRoot, realRendered] = await Promise.all([realpath(root), realpath(rendered)]);
  if (realRendered !== resolve(realRoot, 'rendered'))
    throw new Error('Atlas rendered directory escapes extracted root');
  const output = join(rendered, String(rowId));
  const rgba = readAtlasRgba(root, rowId);
  const native = `${output}.png`;
  const two = `${output}@2x.png`;
  const four = `${output}@4x.png`;
  const absoluteFiles = [native, two, four];
  const temporary = absoluteFiles.map((path) => join(rendered, `.${basename(path)}.${randomUUID()}.tmp`));
  try {
    await Promise.all([
      sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
        .png()
        .toFile(temporary[0]!),
      sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
        .resize(WIDTH * 2, HEIGHT * 2, { kernel: 'nearest' })
        .png()
        .toFile(temporary[1]!),
      sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
        .resize(WIDTH * 4, HEIGHT * 4, { kernel: 'nearest' })
        .png()
        .toFile(temporary[2]!),
    ]);
    await Promise.all(temporary.map((path, at) => rename(path, absoluteFiles[at]!)));
  } finally {
    await Promise.all(temporary.map((path) => rm(path, { force: true })));
  }
  const records = await Promise.all(absoluteFiles.map(fileRecord));
  const recordsWithPaths = records.map((record, at) => ({
    ...record,
    path: join('rendered', basename(absoluteFiles[at]!)),
    role: at === 0 ? ('primary' as const) : ('companion' as const),
  }));
  const relativeFiles: NonNullable<AssetCard['source']>['files'] = [recordsWithPaths[0]!, ...recordsWithPaths.slice(1)];
  return {
    card: {
      ...card,
      source: { files: relativeFiles },
      previews: {
        ...card.previews,
        thumb: join('packs', ATLAS_PACK, ATLAS_VERSION, 'extracted', 'rendered', basename(native)),
      },
    },
    files: relativeFiles.map((file, at) => ({ path: file.path, absolute: absoluteFiles[at]! })),
  };
}

export type AtlasDatabaseInput = {
  captions: string[];
  subjects: string[];
  storageFiles: AtlasStorageFile[];
};

/** One-time intake builder. Search opens the completed database read-only. */
export function buildAtlasDatabase(path: string, input: AtlasDatabaseInput): void {
  if (input.captions.length !== input.subjects.length) throw new Error('Atlas captions and subjects differ in length');
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let published = false;
  try {
    const db = new DatabaseSync(staging);
    try {
      db.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE sprites (row_id INTEGER PRIMARY KEY, caption TEXT NOT NULL, subject TEXT NOT NULL);
        CREATE VIRTUAL TABLE sprites_fts USING fts5(caption, subject, tokenize='unicode61');
        BEGIN;
      `);
      const insert = db.prepare('INSERT INTO sprites(row_id, caption, subject) VALUES (?, ?, ?)');
      const insertFts = db.prepare('INSERT INTO sprites_fts(rowid, caption, subject) VALUES (?, ?, ?)');
      for (let row = 0; row < input.captions.length; row += 1) {
        const caption = assertAtlasText(input.captions[row]!, `caption for row ${row}`);
        const subject = assertAtlasText(input.subjects[row]!, `subject for row ${row}`);
        insert.run(row, caption, subject);
        insertFts.run(row, caption, subject);
      }
      db.prepare('INSERT INTO metadata(name, value) VALUES (?, ?)').run(
        'storage_files',
        JSON.stringify(input.storageFiles),
      );
      db.exec("COMMIT; INSERT INTO sprites_fts(sprites_fts) VALUES ('optimize');");
      const count = db.prepare('SELECT count(*) AS count FROM sprites').get() as { count: number };
      if (count.count !== input.captions.length) throw new Error('Atlas SQLite row count does not match input');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // The failure may have happened before BEGIN or after COMMIT.
      }
      throw error;
    } finally {
      db.close();
    }
    renameSync(staging, path);
    published = true;
  } finally {
    if (!published) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${staging}${suffix}`, { force: true });
    }
  }
}
