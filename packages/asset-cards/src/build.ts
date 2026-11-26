import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import process from 'node:process';

import { validateCard, type AssetCard } from '@ogm/contracts';

import { resolve } from './resolve.js';
import { SoundSetCardSchema, type SoundSetCard } from './sound-set.js';
import type { CardIndex, IndexError, ResolvedCard } from './types.js';

export const INDEX_PATH = join('index', 'cards.index.json');
export const CARD_INDEX_VERSION = 4;
const TOPS = ['packs', 'inspiration', 'sets'];
const INDEX_IGNORE = '.indexignore';
const PACK_ID = /^[a-z0-9][a-z0-9-]*$/;

async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return [];
    throw error;
  }
}

async function cardFilesFor(root: string, top: string, id: string): Promise<string[]> {
  const files: string[] = [];
  const base = join(root, top, id);
  if ((await entries(base)).includes('collection.card.json')) files.push(join(base, 'collection.card.json'));
  if ((await entries(join(base, 'cards'))).includes(INDEX_IGNORE)) return files;
  let nested: string[];
  try {
    nested = await readdir(join(base, 'cards'), { recursive: true });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return files;
    throw error;
  }
  for (const file of nested.filter((name) => name.endsWith('.card.json')).sort()) {
    files.push(join(base, 'cards', file));
  }
  return files;
}

/** Card files: `<top>/<id>/collection.card.json` and `<top>/<id>/cards/**\/*.card.json`; extracted trees are never walked. */
export async function cardFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const top of TOPS) {
    for (const id of (await entries(join(root, top))).sort()) {
      files.push(...(await cardFilesFor(root, top, id)));
    }
  }
  return files;
}

async function buildFromFiles(root: string, files: readonly string[]): Promise<CardIndex> {
  const errors: IndexError[] = [];
  const valid: AssetCard[] = [];
  const soundSets: SoundSetCard[] = [];
  for (const file of files) {
    const path = relative(root, file);
    const contents = await readFile(file, 'utf8');
    let doc: unknown;
    try {
      doc = JSON.parse(contents);
    } catch (error) {
      errors.push({ path, errors: [`unreadable JSON: ${error instanceof Error ? error.message : String(error)}`] });
      continue;
    }
    if (typeof doc === 'object' && doc !== null && 'schema' in doc && doc.schema === 'ogm.sound-set-card/1.0') {
      const result = SoundSetCardSchema.safeParse(doc);
      if (result.success) soundSets.push(result.data);
      else
        errors.push({
          path,
          errors: result.error.issues.map((issue) => `${issue.path.join('/') || '/'} ${issue.message}`),
        });
      continue;
    }
    const result = validateCard(doc);
    if (result.ok) valid.push(result.card);
    else errors.push({ path, errors: result.errors });
  }

  const raw: Record<string, AssetCard> = {};
  for (const card of valid) if (card.card_type === 'collection') raw[card.id] = card;

  const cards: ResolvedCard[] = [];
  const collections: Record<string, ResolvedCard> = {};
  for (const card of valid) {
    let resolved: ResolvedCard;
    try {
      resolved = resolve(card, raw);
    } catch (error) {
      errors.push({ path: card.id, errors: [error instanceof Error ? error.message : String(error)] });
      continue;
    }
    cards.push(resolved);
    if (card.card_type === 'collection') collections[card.id] = resolved;
  }

  const vocab =
    valid
      .map((card) => card.vocab)
      .sort()
      .at(-1) ?? '';
  return { version: CARD_INDEX_VERSION, built: new Date().toISOString(), vocab, cards, collections, soundSets, errors };
}

export async function buildIndex(root: string): Promise<CardIndex> {
  return buildFromFiles(root, await cardFiles(root));
}

/** Resolve only named packs, without reading or writing the library-wide index. Invalid/path-like ids are ignored. */
export async function buildPackIndex(root: string, packIds: readonly string[]): Promise<CardIndex> {
  const files: string[] = [];
  for (const id of [...new Set(packIds)].filter((candidate) => PACK_ID.test(candidate)).sort()) {
    files.push(...(await cardFilesFor(root, 'packs', id)));
    files.push(...(await cardFilesFor(root, 'sets', id)));
  }
  return buildFromFiles(root, files);
}

export async function writeIndex(root: string, index: CardIndex): Promise<string> {
  const path = join(root, INDEX_PATH);
  const directory = join(root, 'index');
  const temporary = join(directory, `.cards.index.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(index)}\n`);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return path;
}

async function freshIndex(root: string): Promise<CardIndex | null> {
  let index: CardIndex;
  let built: number;
  try {
    const parsed = JSON.parse(await readFile(join(root, INDEX_PATH), 'utf8')) as Partial<CardIndex>;
    if (
      parsed.version !== CARD_INDEX_VERSION ||
      !Array.isArray(parsed.cards) ||
      typeof parsed.collections !== 'object' ||
      parsed.collections === null ||
      !Array.isArray(parsed.soundSets) ||
      !Array.isArray(parsed.errors)
    ) {
      return null;
    }
    index = parsed as CardIndex;
    built = (await stat(join(root, INDEX_PATH))).mtimeMs;
  } catch {
    return null;
  }
  for (const top of TOPS) {
    for (const id of await entries(join(root, top))) {
      try {
        if ((await stat(join(root, top, id, 'cards'))).mtimeMs > built) return null;
      } catch {
        // A pack without a per-asset cards directory has no nested index inputs.
      }
    }
  }
  for (const file of await cardFiles(root)) {
    if ((await stat(file)).mtimeMs > built) return null;
  }
  return index;
}

/** True when the index is missing, uses an older cache format, is malformed, or any card file is newer. */
export async function isStale(root: string): Promise<boolean> {
  return (await freshIndex(root)) === null;
}

/** Read the index, rebuilding it when missing or stale; read-only workers use the fresh in-memory result. */
export async function loadIndex(root: string): Promise<CardIndex> {
  const current = await freshIndex(root);
  if (current) return current;
  const index = await buildIndex(root);
  try {
    await writeIndex(root, index);
  } catch (error) {
    process.emitWarning(
      `asset card index is stale and could not be written; using a fresh in-memory index (${error instanceof Error ? error.message : String(error)})`,
      { code: 'OGM_ASSET_INDEX_READ_ONLY' },
    );
  }
  return index;
}
