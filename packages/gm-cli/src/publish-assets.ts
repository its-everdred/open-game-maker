import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, mkdir, open, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

import { cardById, loadIndex, type ResolvedCard } from '@ogm/asset-cards';
import { AssetsLockSchema, type AssetsLock, type LockEntry } from '@ogm/contracts';
import { FsBlobStore } from '@ogm/blob-store';

import { planUsed } from './assets-export/plan.js';
import { sha256File } from './lock.js';
import { refusalsForCheck, rightsForCard } from './rules.js';
import { collectionParts } from './resolve.js';
import { MIME } from './commands/packs/index.js';

export async function readPublishLock(game: string): Promise<AssetsLock | null> {
  const lockPath = join(game, 'assets.lock.json');
  const file = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') throw new Error('assets.lock.json must be a regular file');
    throw error;
  });
  if (!file) return null;
  try {
    if (!(await file.stat()).isFile()) throw new Error('assets.lock.json must be a regular file');
    return AssetsLockSchema.parse(JSON.parse(await file.readFile('utf8')));
  } finally {
    await file.close();
  }
}

/** A host-trusted grant, derived independently of the game-controlled lock. */
export type PublishBlobGrant = { license: string; rights: LockEntry['rights'] };

/**
 * Compatibility for existing games: the current asset system stores no authoritative per-game blob grants.
 * This narrows the host access that existing builds already have to the lock's pinned hashes. The game-authored
 * rights are not independent ownership or licence evidence; per-game provenance is still required.
 */
export async function legacyBlobGrants(game: string): Promise<Map<string, PublishBlobGrant>> {
  const lock = await readPublishLock(game);
  const grants = new Map<string, PublishBlobGrant>();
  for (const entry of lock?.assets ?? []) {
    if (entry.source !== 'blob') continue;
    for (const hash of [entry.sha256, ...(entry.files ?? []).map((file) => file.sha256)]) {
      const grant = { license: entry.license, rights: entry.rights };
      const prior = grants.get(hash);
      if (prior && JSON.stringify(prior) !== JSON.stringify(grant)) {
        throw new Error(`conflicting rights for blob ${hash}`);
      }
      grants.set(hash, grant);
    }
  }
  return grants;
}

/** Copy only verified, in-game licensed lock entries into the game sandbox. */
export async function stagePublishAssets(
  game: string,
  destination: string,
  assetsRoot: string | null,
  blobRoot: string | null,
  visibility: 'public' | 'private' = 'public',
  authorizedBlobs: ReadonlyMap<string, PublishBlobGrant> = new Map(),
): Promise<void> {
  const lock = await readPublishLock(game);
  await mkdir(join(destination, 'packs'), { recursive: true });
  if (!lock || lock.assets.length === 0) return;
  const index = assetsRoot ? await loadIndex(assetsRoot) : null;
  const cards = new Map<string, ResolvedCard>();
  const blobMimes = new Map<string, string>();
  for (const entry of lock.assets) {
    if (entry.source === 'blob') {
      for (const item of [{ path: entry.path, sha256: entry.sha256 }, ...(entry.files ?? [])]) {
        const hash = item.sha256;
        blobMimes.set(hash, MIME[extname(item.path).toLowerCase()] ?? 'application/octet-stream');
        const grant = authorizedBlobs.get(hash);
        if (
          !grant ||
          grant.license !== entry.license ||
          grant.rights.audience !== entry.rights.audience ||
          grant.rights.redistribution !== entry.rights.redistribution ||
          grant.rights.attribution !== entry.rights.attribution ||
          [...grant.rights.uses].sort().join('\0') !== [...entry.rights.uses].sort().join('\0')
        ) {
          throw new Error(`blob ${entry.id} has no trusted per-game authorization`);
        }
      }
    }
    const card = index && assetsRoot ? cardById(assetsRoot, index, entry.id) : undefined;
    if (card) cards.set(card.id, card);
    const refusals = refusalsForCheck(
      entry,
      card,
      { exists: true, sha256: entry.sha256 },
      {
        publish: true,
        visibility,
        ...(card && index ? { currentRights: rightsForCard(card, index.collections) } : {}),
      },
    );
    if (refusals.length)
      throw new Error(
        `asset ${entry.id} cannot be used in a published build: ${refusals.map((item) => item.rule).join(', ')}`,
      );
  }
  // in-build licences are allowed here: only this game's pinned files enter its build sandbox.
  const plan = await planUsed([{ id: 'publish', dir: game, lock }], assetsRoot, blobRoot, index, true);
  if (plan.missing.length) throw new Error(`cannot stage assets: ${plan.missing.join('; ')}`);
  // Do not copy other assets' cards from a shared pack. Write only locked cards and their collection metadata.
  const writeCard = async (target: string, card: ResolvedCard) => {
    const raw = Object.fromEntries(
      Object.entries(card).filter(([key]) => key !== 'resolved' && key !== 'library_root'),
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(raw));
  };
  for (const card of cards.values()) {
    if (!card.collection) continue;
    const { slug } = collectionParts(card.id);
    const collection = index?.collections[card.collection];
    if (!collection) throw new Error(`missing collection for ${card.id}`);
    const pack = join(destination, 'packs', slug);
    await writeCard(join(pack, 'collection.card.json'), collection);
    const name = createHash('sha256').update(card.id).digest('hex');
    await writeCard(join(pack, 'cards', `${name}.card.json`), card);
  }
  const blobStore = blobRoot
    ? new FsBlobStore({ root: blobRoot, signingKey: 'unused', publicOrigin: 'http://127.0.0.1' })
    : null;
  for (const file of plan.files.filter((item) => item.ids.length > 0)) {
    const path = file.path.startsWith('library/')
      ? `packs/${file.path.slice('library/'.length)}`
      : `blob-store/blobs/sha256/${file.path.slice('blobs/'.length)}`;
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(file.file, target);
    if (file.sha256 && (await sha256File(target)) !== file.sha256)
      throw new Error(`asset changed while staging: ${file.ids.join(', ')}`);
    if (file.path.startsWith('blobs/')) {
      const hash = file.sha256;
      if (!hash || !authorizedBlobs.has(hash) || !blobStore) throw new Error('blob has no trusted authorization');
      const metadata = await blobStore.head(`sha256:${hash}`).catch(() => null);
      const bytes = (await stat(target)).size;
      const mime = metadata?.bytes === bytes ? metadata.mime : (blobMimes.get(hash) ?? 'application/octet-stream');
      await writeFile(`${target}.json`, JSON.stringify({ bytes, mime, createdAt: new Date(0).toISOString() }));
    }
  }
}
