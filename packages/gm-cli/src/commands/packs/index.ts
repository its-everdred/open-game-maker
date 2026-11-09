import { createReadStream } from 'node:fs';
import { extname, join } from 'node:path';

import {
  buildIndex,
  buildMapIndex,
  coverageTable,
  loadFamilies,
  recompute,
  writeFamilies,
  writeIndex,
  writeMapIndex,
  writeMapLayouts,
  type CardIndex,
} from '@ogm/asset-cards';
import { FsBlobStore, type BlobHash } from '@ogm/blob-store';

import { EXIT, UsageError, type GmCommand, type GmContext } from '../../command.js';
import { printJson, requireAssetsRoot } from '../../context.js';
import { PREVIEW_KINDS, sha256File, walk, type PreviewKind } from '../../packs/hashwalk.js';
import { indexedSpecs } from '../../maps/specs.js';

/** Library prefixes copied into the blob store; originals are never read here, let alone moved. */
const IMPORT_PREFIXES = ['previews', join('private', 'previews'), join('private', 'hash-manifests')];

export const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

/** The index entry fields this command adds; the card files on disk never carry them. */
export type PreviewBlobs = {
  previews?: { blob?: Partial<Record<PreviewKind, BlobHash>> };
  visibility?: 'private' | 'library';
};

export type ImportStats = { put: number; skipped: number; mapped: number };

/** Put every preview and private manifest into the store (idempotent by hash) and record `previews.blob` on the index entries. */
export async function importPreviews(root: string, blobRoot: string, index: CardIndex): Promise<ImportStats> {
  // put/head never sign, so the store gets a placeholder origin and key rather than the API's secrets.
  const store = new FsBlobStore({ root: blobRoot, signingKey: 'unused', publicOrigin: 'http://127.0.0.1' });
  const keyToHash = new Map<string, BlobHash>();
  const stats: ImportStats = { put: 0, skipped: 0, mapped: 0 };
  for (const prefix of IMPORT_PREFIXES) {
    for await (const file of walk(root, join(root, prefix))) {
      const hash: BlobHash = `sha256:${await sha256File(file.abs)}`;
      keyToHash.set(file.rel, hash);
      if (await store.head(hash)) {
        stats.skipped += 1;
        continue;
      }
      const stored = await store.put(
        createReadStream(file.abs),
        MIME[extname(file.abs).toLowerCase()] ?? 'application/octet-stream',
      );
      if (stored.hash !== hash) throw new Error(`${file.rel} changed while importing`);
      stats.put += 1;
    }
  }

  for (const card of index.cards) {
    const entry = card as typeof card & PreviewBlobs;
    if (!entry.previews) continue;
    const blob: Partial<Record<PreviewKind, BlobHash>> = {};
    let isPrivate = false;
    for (const kind of PREVIEW_KINDS) {
      const key = card.previews?.[kind];
      const hash = key ? keyToHash.get(key) : undefined;
      if (!key || !hash) continue;
      blob[kind] = hash;
      if (key.startsWith('private/')) isPrivate = true;
    }
    if (Object.keys(blob).length === 0) continue;
    entry.previews.blob = blob;
    entry.visibility = isPrivate ? 'private' : 'library';
    stats.mapped += 1;
  }
  return stats;
}

async function runIndex(ctx: GmContext, flags: Record<string, unknown>): Promise<number> {
  const root = requireAssetsRoot(ctx);
  const blobRoot = flags['import-previews'] === true ? ctx.blobRoot : undefined;
  if (blobRoot === null) {
    throw new UsageError(
      'OGM_BLOB_ROOT is unset; --import-previews needs the blob store root',
      'OGM_BLOB_ROOT=~/.local/share/ogm/blobs gm packs index --import-previews',
    );
  }
  const index = await buildIndex(root);
  const imported = blobRoot ? await importPreviews(root, blobRoot, index) : null;
  const familyReport = flags.families === true ? recompute(index, loadFamilies()) : null;
  if (familyReport && familyReport.failures.length === 0) writeFamilies(familyReport.families);
  await writeIndex(root, index);
  // The map-inspiration index is derived from the same cards + layout specs, so one command keeps both current.
  const { specs } = await indexedSpecs(root, index);
  const { maps, hidden } = buildMapIndex(index, specs);
  await Promise.all([writeMapIndex(root, maps), writeMapLayouts(root, maps, specs)]);

  const summary = {
    cards: index.cards.length,
    collections: Object.keys(index.collections).length,
    errors: index.errors.length,
    maps: maps.rows.length,
    map_rows_hidden: hidden,
    ...(imported ?? {}),
    ...(familyReport ? { families: familyReport.families.length, family_failures: familyReport.failures.length } : {}),
  };
  if (ctx.json)
    printJson(ctx, {
      ...summary,
      error_paths: index.errors.map((error) => error.path),
      ...(familyReport
        ? { family_coverage: Object.fromEntries(familyReport.families.map((family) => [family.id, family.coverage])) }
        : {}),
    });
  else {
    ctx.out(`${summary.cards} cards, ${summary.collections} collections, ${summary.errors} errors`);
    ctx.out(`maps: ${summary.maps} layout rows (${summary.map_rows_hidden} hidden for rights)`);
    for (const error of index.errors) ctx.out(`  ${error.path}: ${error.errors.join('; ')}`);
    if (imported)
      ctx.out(`previews: ${imported.put} put, ${imported.skipped} already stored, ${imported.mapped} cards mapped`);
    if (familyReport) coverageTable(familyReport.families).forEach(ctx.out);
  }
  for (const failure of familyReport?.failures ?? []) ctx.err(failure);
  ctx.emit('assets.index', summary);
  return familyReport && familyReport.failures.length > 0 ? EXIT.failed : EXIT.ok;
}

export const command: GmCommand = {
  name: 'packs index',
  summary: 'rebuild the card index now; optionally refresh families or import previews',
  usage: '[--families] [--import-previews]',
  example: 'packs index --families --import-previews --json',
  flags: {
    families: {
      type: 'boolean',
      default: false,
      help: 'recompute and write style-family coverage from the rebuilt index',
    },
    'import-previews': {
      type: 'boolean',
      default: false,
      help: 'put previews and private hash manifests into $OGM_BLOB_ROOT and map them on index entries',
    },
  },
  run: (ctx, _args, flags) => runIndex(ctx, flags),
};
