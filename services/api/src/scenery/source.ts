import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildPackIndex } from '@ogm/asset-cards';
import type { BlobStore } from '@ogm/blob-store';
import { AssetsLockSchema, parseScenery, type AssetsLock, type Scenery } from '@ogm/contracts';

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const runFile = promisify(execFile);

async function sceneUpdatedAt(root: string, path: string): Promise<string> {
  const modified = (await stat(path)).mtime.toISOString();
  try {
    const args = ['-C', root];
    const status = await runFile('git', [...args, 'status', '--porcelain', '--', 'scenery.json'], { timeout: 2_000 });
    if (status.stdout.trim()) return modified;
    const log = await runFile('git', [...args, 'log', '-1', '--format=%cI', '--', 'scenery.json'], { timeout: 2_000 });
    const timestamp = Date.parse(log.stdout.trim());
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : modified;
  } catch {
    return modified;
  }
}

function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return part === '' || (!part.startsWith('..') && !isAbsolute(part));
}

async function contained(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const target = await realpath(resolve(base, path));
  if (!inside(base, target)) throw new Error('file outside allowed directory');
  return target;
}

/** Read only the registered game's lock and scenery, never arbitrary checkout paths. */
export async function readGameLock(checkout: string, gamePath: string): Promise<{ root: string; lock: AssetsLock }> {
  const root = await contained(checkout, gamePath);
  const lockFile = await contained(root, 'assets.lock.json');
  const lock = AssetsLockSchema.parse(JSON.parse(await readFile(lockFile, 'utf8')));
  return { root, lock };
}

export async function readScenerySource(
  checkout: string,
  gamePath: string,
  includeUpdatedAt = true,
): Promise<{ root: string; lock: AssetsLock; scene: Scenery; updatedAt?: string }> {
  const { root, lock } = await readGameLock(checkout, gamePath);
  let data: unknown;
  let updatedAt: string | undefined;
  try {
    const path = await contained(root, 'scenery.json');
    data = JSON.parse(await readFile(path, 'utf8'));
    if (includeUpdatedAt) updatedAt = await sceneUpdatedAt(root, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    data = {
      version: 1,
      items: [],
      terrain: [],
      lighting: 'warm-forest',
      camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
    };
  }
  return { root, lock, scene: parseScenery(data, lock.assets), ...(updatedAt ? { updatedAt } : {}) };
}

/** Resolve a lock-owned file, enforcing the recorded hash and directory boundary. */
export async function readSceneryFile(options: {
  root: string;
  lock: AssetsLock;
  assetId: string;
  path: string;
  assetsRoot?: string;
  blobStore: BlobStore;
}): Promise<Uint8Array> {
  const entry = options.lock.assets.find((candidate) => candidate.id === options.assetId);
  if (!entry) throw new Error('asset not locked');
  const file = [{ path: entry.path, sha256: entry.sha256 }, ...(entry.files ?? [])].find(
    (candidate) => candidate.path === options.path,
  );
  if (!file) throw new Error('file not locked');
  let bytes: Uint8Array;
  if (entry.source === 'blob') {
    const opened = await options.blobStore.open(`sha256:${file.sha256}`);
    if (!opened || opened.ref.bytes > MAX_FILE_BYTES) throw new Error('locked file unavailable');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of opened.stream) {
      const part = Buffer.from(chunk as Uint8Array);
      size += part.length;
      if (size > MAX_FILE_BYTES) throw new Error('locked file too large');
      chunks.push(part);
    }
    bytes = Buffer.concat(chunks);
  } else {
    let root = options.root;
    if (entry.source === 'library') {
      if (!options.assetsRoot) throw new Error('asset library unavailable');
      const match = /^t[12]:([^/]+)\/.*@([^@]+)$/.exec(entry.id);
      if (!match) throw new Error('invalid library asset');
      const slug = match[1]!;
      const version = match[2]!;
      const index = await buildPackIndex(options.assetsRoot, [slug]);
      const collection = index.collections[entry.id.replace(/\/.*@/, '@')];
      const manifest = collection?.collection_info?.pack_manifest?.replace(/^assets-local\//, '');
      const candidates = [
        ...(manifest ? [join(options.assetsRoot, dirname(manifest), version, 'extracted')] : []),
        join(options.assetsRoot, 'packs', slug, version, 'extracted'),
        join(options.assetsRoot, 'inspiration', slug, version, 'extracted'),
      ];
      let found: string | undefined;
      for (const candidate of candidates) {
        try {
          found = await contained(options.assetsRoot, candidate);
          break;
        } catch {
          /* Try the next library location. */
        }
      }
      if (!found) throw new Error('asset library unavailable');
      root = found;
    }
    const path = await contained(root, file.path);
    if ((await stat(path)).size > MAX_FILE_BYTES) throw new Error('locked file too large');
    bytes = await readFile(path);
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('locked file too large');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('locked file hash mismatch');
  return bytes;
}
