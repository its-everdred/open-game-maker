import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { validateCard, type AssetCard } from '@ogm/contracts';

import { resolve } from './resolve.js';
import type { CardIndex, IndexError, ResolvedCard } from './types.js';

export const INDEX_PATH = join('index', 'cards.index.json');
export const CARD_INDEX_VERSION = 2;
const TOPS = ['packs', 'inspiration'];
const INDEX_IGNORE = '.indexignore';

async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Card files: `<top>/<id>/collection.card.json` and `<top>/<id>/cards/**\/*.card.json`; extracted trees are never walked. */
export async function cardFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const top of TOPS) {
    for (const id of (await entries(join(root, top))).sort()) {
      const base = join(root, top, id);
      if ((await entries(base)).includes('collection.card.json')) files.push(join(base, 'collection.card.json'));
      if ((await entries(join(base, 'cards'))).includes(INDEX_IGNORE)) continue;
      let nested: string[];
      try {
        nested = await readdir(join(base, 'cards'), { recursive: true });
      } catch {
        continue;
      }
      for (const file of nested.filter((name) => name.endsWith('.card.json')).sort()) {
        files.push(join(base, 'cards', file));
      }
    }
  }
  return files;
}

export async function buildIndex(root: string): Promise<CardIndex> {
  const errors: IndexError[] = [];
  const valid: AssetCard[] = [];
  for (const file of await cardFiles(root)) {
    const path = relative(root, file);
    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      errors.push({ path, errors: [`unreadable JSON: ${error instanceof Error ? error.message : String(error)}`] });
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
  return { version: CARD_INDEX_VERSION, built: new Date().toISOString(), vocab, cards, collections, errors };
}

export async function writeIndex(root: string, index: CardIndex): Promise<string> {
  const path = join(root, INDEX_PATH);
  await mkdir(join(root, 'index'), { recursive: true });
  await writeFile(path, `${JSON.stringify(index)}\n`);
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

/** Read the index, rebuilding and writing it first when it is missing or stale. */
export async function loadIndex(root: string): Promise<CardIndex> {
  const current = await freshIndex(root);
  if (current) return current;
  const index = await buildIndex(root);
  await writeIndex(root, index);
  return index;
}
