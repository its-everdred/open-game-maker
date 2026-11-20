import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

import type { ResolvedCard } from '@ogm/asset-cards';
import { blobPath } from '@ogm/blob-store';
import type { LockEntry } from '@ogm/contracts';

import { resolveContainedPath } from './context.js';
import { sha256File } from './lock.js';

export type EntrySource = NonNullable<LockEntry['source']>;

export type ResolvedFile = { path: string; absolute: string; sha256: string };

export type Resolution =
  | { ok: true; primary: string; files: ResolvedFile[] }
  | { ok: false; rule: 'missing-file' | 'sha-mismatch'; detail: string; fix: string };

export type Locations = {
  cwd: string;
  assetsRoot: string | null;
  blobRoot: string | null;
  /** Collection cards by id, for packs whose manifest names a non-default folder. */
  collections?: Record<string, ResolvedCard>;
};

/** Lock entries written before `source` existed hold repo copies. */
export function entrySource(entry: LockEntry): EntrySource {
  return entry.source ?? 'vendored';
}

export function collectionParts(id: string): { tier: string; slug: string; version: string } {
  const match = /^(t[123]):([^/@]+)\/.*@([^@]+)$/.exec(id);
  if (!match) throw new Error(`asset ${id} has no versioned collection id`);
  return { tier: match[1]!, slug: match[2]!, version: match[3]! };
}

/** The extracted folder of an asset's pack inside the library. */
export function libraryRoot(assetsRoot: string, id: string, collection?: ResolvedCard): string {
  const { slug, version } = collectionParts(id);
  const fromManifest = collection?.collection_info?.pack_manifest?.replace(/^assets-local\//, '');
  const candidates = [
    ...(fromManifest ? [join(assetsRoot, dirname(fromManifest), version, 'extracted')] : []),
    join(assetsRoot, 'packs', slug, version, 'extracted'),
    join(assetsRoot, 'inspiration', slug, version, 'extracted'),
    join(assetsRoot, 'sets', slug, version, 'extracted'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Repo files a lock entry owns: none for library and blob entries; the primary and `files[]` for vendored ones.
 * Older locks did not list companions; those sit beside the primary under their library basename.
 */
export function repoPaths(entry: LockEntry, card?: ResolvedCard): string[] {
  if (entrySource(entry) !== 'vendored') return [];
  if (entry.files !== undefined) return [entry.path, ...entry.files.map((file) => file.path)];
  const companions = (card?.source?.files ?? [])
    .filter((file) => file.role === 'texture' || file.role === 'companion')
    .map((file) => join(dirname(entry.path), basename(file.path)).replaceAll(sep, '/'));
  return [entry.path, ...companions];
}

function fixFor(entry: LockEntry, source: EntrySource): string {
  if (source === 'vendored') {
    return entry.id.startsWith('t3:')
      ? `gm assets register ${entry.path} --made-by-agent`
      : `gm assets use ${entry.id} --vendor`;
  }
  if (source === 'blob') return 'restore the instance blob store (OGM_BLOB_ROOT) from its backup';
  const { tier, slug } = collectionParts(entry.id);
  return tier === 't2' ? `gm packs sync ${slug}` : `gm packs import <drop> --id ${slug}`;
}

async function containedFile(root: string, path: string): Promise<string | null> {
  try {
    const real = await resolveContainedPath(root, resolve(root, path));
    return real !== null && (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** Find an entry's primary file and every companion, each sha256-verified against the lock. */
export async function resolveEntry(entry: LockEntry, where: Locations): Promise<Resolution> {
  const source = entrySource(entry);
  const fix = fixFor(entry, source);
  const files = [{ path: entry.path, sha256: entry.sha256 }, ...(entry.files ?? [])];
  let root: string;
  if (source === 'vendored') root = where.cwd;
  else if (source === 'library') {
    if (where.assetsRoot === null) {
      return { ok: false, rule: 'missing-file', detail: 'no asset library: OGM_ASSETS_ROOT is unset', fix };
    }
    const collectionId = entry.id.replace(/\/.*@/, '@');
    root = libraryRoot(where.assetsRoot, entry.id, where.collections?.[collectionId]);
  } else {
    if (where.blobRoot === null) {
      return { ok: false, rule: 'missing-file', detail: 'no blob store: OGM_BLOB_ROOT is unset', fix };
    }
    root = where.blobRoot;
  }

  let primary: string | null = null;
  const resolved: ResolvedFile[] = [];
  for (const file of files) {
    const absolute =
      source === 'blob'
        ? await containedFile(root, blobPath(root, `sha256:${file.sha256}`))
        : await containedFile(root, file.path);
    if (absolute === null) {
      return { ok: false, rule: 'missing-file', detail: `${file.path} is missing from the ${source} source`, fix };
    }
    if ((await sha256File(absolute)) !== file.sha256) {
      return { ok: false, rule: 'sha-mismatch', detail: `${file.path} sha256 does not match the lock`, fix };
    }
    primary ??= absolute;
    resolved.push({ ...file, absolute });
  }
  return { ok: true, primary: primary!, files: resolved };
}
