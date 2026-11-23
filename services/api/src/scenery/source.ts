import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildPackIndex } from '@ogm/asset-cards';
import type { BlobStore } from '@ogm/blob-store';
import {
  AssetsLockSchema,
  parseScenery,
  SceneIdSchema,
  SceneRevisionSchema,
  type AssetsLock,
  type SceneHead,
  type SceneRevision,
  type Scenery,
} from '@ogm/contracts';
import { migrateScene } from '@ogm/design-log';

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const runFile = promisify(execFile);

async function branchObject(root: string, ref: string): Promise<string> {
  const result = await runFile('git', ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
    timeout: 5_000,
  });
  const sha = result.stdout.trim();
  if (!/^[a-f0-9]{40,64}$/u.test(sha)) throw new Error('invalid branch');
  return sha;
}

export async function resolveSceneryCommit(checkout: string, gamePath: string, ref: string): Promise<string> {
  return branchObject(await gitGameRoot(checkout, gamePath), ref);
}

async function gitGameRoot(checkout: string, gamePath: string): Promise<string> {
  const base = await realpath(checkout);
  const top = (await runFile('git', ['-C', base, 'rev-parse', '--show-toplevel'], { timeout: 5_000 })).stdout.trim();
  if ((await realpath(top)) !== base) throw new Error('checkout is not a repository root');
  return contained(base, gamePath);
}

async function branchFile(root: string, sha: string, path: string): Promise<Buffer> {
  if (isAbsolute(path) || path.split('/').some((part) => part === '..' || part === '.'))
    throw new Error('invalid path');
  const prefix = (await runFile('git', ['-C', root, 'rev-parse', '--show-prefix'], { timeout: 5_000 })).stdout.trim();
  const result = await runFile('git', ['-C', root, 'show', `${sha}:${prefix}${path}`], {
    timeout: 5_000,
    maxBuffer: MAX_FILE_BYTES,
    encoding: 'buffer',
  });
  return result.stdout;
}

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
  ref?: string,
  fallbackRef?: string,
): Promise<{ root: string; lock: AssetsLock; scene: Scenery; updatedAt?: string; commit?: string }> {
  if (ref) {
    const root = await gitGameRoot(checkout, gamePath);
    const commit = await branchObject(root, ref).catch((error: unknown) => {
      const stderr = (error as { stderr?: Buffer | string }).stderr;
      if (!fallbackRef || !stderr || !String(stderr).includes('Needed a single revision')) throw error;
      return branchObject(root, fallbackRef);
    });
    const lock = AssetsLockSchema.parse(
      JSON.parse((await branchFile(root, commit, 'assets.lock.json')).toString('utf8')),
    );
    let sceneFile: Buffer | undefined;
    try {
      sceneFile = await branchFile(root, commit, 'scenery.json');
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string }).stderr;
      if (!stderr || !String(stderr).includes('does not exist in')) throw error;
      sceneFile = undefined;
    }
    const data: unknown = sceneFile
      ? JSON.parse(sceneFile.toString('utf8'))
      : {
          version: 1,
          items: [],
          terrain: [],
          lighting: 'warm-forest',
          camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
        };
    return { root, lock, scene: parseScenery(data, lock.assets), commit };
  }
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

export type SceneSummary = {
  id: string;
  rev: number;
  /** Who wrote the head revision. */
  author: string;
  updatedAt: string;
  /** The ticket whose agent wrote revision 1; absent when a creator started the scene. */
  ticket?: string;
  /** Each agent ticket that wrote a revision, with the latest revision it wrote: what its review card opens. */
  agents: Record<string, number>;
};

/** A scene's list entry from its committed log (revisions 1..rev in order). */
export function sceneSummary(id: string, log: readonly SceneRevision[]): SceneSummary {
  const last = log.at(-1)!;
  const agents: Record<string, number> = {};
  for (const revision of log) {
    if (revision.author.startsWith('agent:')) agents[revision.author.slice('agent:'.length)] = revision.rev;
  }
  const first = log[0]!.author;
  return {
    id,
    rev: last.rev,
    author: last.author,
    updatedAt: last.createdAt,
    ...(first.startsWith('agent:') ? { ticket: first.slice('agent:'.length) } : {}),
    agents,
  };
}
export type SceneFiles = { head: SceneHead; log: SceneRevision[] };

/** One scene's committed head and log, read the way `gm scene pull` reads them; undefined when pull would refuse it. */
async function readSceneIn(dir: string, id: string, game?: string): Promise<SceneFiles | undefined> {
  if (!SceneIdSchema.safeParse(id).success) return undefined;
  try {
    const head = JSON.parse(await readFile(await contained(dir, `${id}.scene.json`), 'utf8')) as {
      rev?: unknown;
      doc?: unknown;
    };
    const rev = head.rev;
    if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 1) return undefined;
    const doc = migrateScene(head.doc).doc;
    if (doc.scene !== id || (game !== undefined && doc.game !== game)) return undefined;
    const lines = (await readFile(await contained(dir, `${id}.revs.jsonl`), 'utf8'))
      .split('\n')
      .filter((line) => line.trim())
      .slice(0, rev);
    const log = lines.map((line) => SceneRevisionSchema.parse(JSON.parse(line)));
    if (log.length !== rev || log.some((revision, index) => revision.rev !== index + 1)) return undefined;
    return { head: { rev, doc }, log };
  } catch {
    return undefined;
  }
}

async function scenesDir(checkout: string, gamePath: string): Promise<string | undefined> {
  const root = await contained(checkout, gamePath);
  try {
    return await contained(root, 'scenes');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** A scene document committed in the game's checkout (`scenes/<scene>.scene.json` and its log), if `gm scene pull` would accept it. */
export async function readSceneFiles(checkout: string, gamePath: string, id: string): Promise<SceneFiles | undefined> {
  const dir = await scenesDir(checkout, gamePath);
  return dir ? readSceneIn(dir, id) : undefined;
}

/**
 * The game's scene documents (`scenes/<scene>.scene.json` heads, #1207), each with who wrote its head revision. Each is
 * read the way `gm scene pull` reads it: the head holds a valid document for that scene, and its log holds revisions
 * 1..rev in order (lines after `rev` never committed). A scene that `gm scene pull` would refuse is left out.
 */
export async function listSceneDocs(checkout: string, gamePath: string, game?: string): Promise<SceneSummary[]> {
  const dir = await scenesDir(checkout, gamePath);
  if (!dir) return [];
  const scenes: SceneSummary[] = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!name.endsWith('.scene.json')) continue;
    const id = name.slice(0, -'.scene.json'.length);
    const files = await readSceneIn(dir, id, game);
    if (!files) continue;
    scenes.push(sceneSummary(id, files.log));
  }
  return scenes;
}

/** Resolve a lock-owned file, enforcing the recorded hash and directory boundary. */
export async function readSceneryFile(options: {
  root: string;
  lock: AssetsLock;
  assetId: string;
  path: string;
  assetsRoot?: string;
  blobStore: BlobStore;
  commit?: string;
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
    if (options.commit && entry.source !== 'library') bytes = await branchFile(root, options.commit, file.path);
    else {
      const path = await contained(root, file.path);
      if ((await stat(path)).size > MAX_FILE_BYTES) throw new Error('locked file too large');
      bytes = await readFile(path);
    }
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('locked file too large');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('locked file hash mismatch');
  return bytes;
}
