import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNoSymlinks, generatedPath, sha256, stableJson, writeIfChanged } from './files.js';
import type { BuildItem, BuildJob, CacheIdentity, FreshJobResult, JobResult } from './types.js';

/**
 * One item's digest: a single-file item keeps the plain file digest it always had, so existing cache keys stay valid;
 * a card with sheets folds every file's lock path and sha256 in, so a changed companion invalidates the build too.
 */
async function itemDigest(item: BuildItem, refresh: boolean): Promise<string> {
  const files = item.files;
  if (files === undefined || files.length <= 1) {
    return !refresh && item.sourceHash ? item.sourceHash : sha256(await readFile(item.source));
  }
  const digests: Array<{ path: string; sha256: string }> = [];
  for (const file of files) {
    digests.push({ path: file.path, sha256: refresh ? sha256(await readFile(file.absolute)) : file.sha256 });
  }
  return sha256(stableJson(digests));
}

export async function sourceDigest(job: BuildJob, refresh = false): Promise<string> {
  const sources: Array<{ id: string; sha256: string }> = [];
  for (const item of job.items) {
    sources.push({ id: item.entry.id, sha256: await itemDigest(item, refresh) });
  }
  return sha256(stableJson(sources));
}

let fingerprint: Promise<string> | undefined;

/**
 * A digest of the asset builder's own code (this directory), folded into every cache key: checkouts on different
 * branches share the cache, so a branch that changes how assets are encoded must not be served another branch's output.
 */
export function builderFingerprint(): Promise<string> {
  fingerprint ??= (async () => {
    const directory = fileURLToPath(new URL('.', import.meta.url));
    const names = (await readdir(directory)).filter((name) => /\.(?:js|ts)$/.test(name) && !name.endsWith('.d.ts'));
    const files: Array<{ name: string; sha256: string }> = [];
    for (const name of names.sort()) files.push({ name, sha256: sha256(await readFile(join(directory, name))) });
    return sha256(stableJson(files));
  })();
  return fingerprint;
}

export async function cacheIdentity(job: BuildJob): Promise<CacheIdentity> {
  const sourceHash = await sourceDigest(job);
  const builder = await builderFingerprint();
  return { sourceHash, key: `${sourceHash}-${sha256(stableJson({ recipe: job.recipe, builder }))}` };
}

function validateGeneratedNames(result: JobResult): void {
  for (const name of Object.keys(result.files)) generatedPath('.', name);
  for (const asset of Object.values(result.assets)) {
    for (const name of Object.values(asset.file)) if (name) generatedPath('.', name);
  }
  for (const names of Object.values(result.companions ?? {})) {
    for (const name of names) generatedPath('.', name);
  }
}

const DEFAULT_MAX_MB = 8192;

/**
 * The asset cache every build on this host shares, so a fresh checkout (og-merge, og-publish, a worker) reuses what any
 * other checkout already built: `GM_ASSET_CACHE_DIR`, else `$XDG_CACHE_HOME/ogm/assets`, else `~/.cache/ogm/assets`.
 * A host where that directory can't be created or written (a read-only sandbox home) falls back to the repo's
 * `.gm/cache/assets`.
 */
export async function assetCacheDir(
  cwd: string,
  env: Record<string, string | undefined>,
  home: string = homedir(),
): Promise<string> {
  const configured = env.GM_ASSET_CACHE_DIR;
  const shared = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(cwd, configured)
    : join(env.XDG_CACHE_HOME || join(home, '.cache'), 'ogm', 'assets');
  try {
    await mkdir(shared, { recursive: true });
    await access(shared, constants.W_OK);
    return shared;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (!['EACCES', 'EROFS', 'EPERM', 'ENOTDIR', 'EEXIST'].includes(code)) throw error;
    return join(cwd, '.gm/cache/assets');
  }
}

/** `GM_ASSET_CACHE_MAX_MB` (default 8 GiB): the size the shared cache is trimmed back to after each build. */
export function assetCacheMaxBytes(env: Record<string, string | undefined>): number {
  const value = Number(env.GM_ASSET_CACHE_MAX_MB);
  return (env.GM_ASSET_CACHE_MAX_MB && Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAX_MB) * 1024 * 1024;
}

const ENTRY = /^[0-9a-f]{64}-[0-9a-f]{64}$/;

async function treeBytes(path: string): Promise<number> {
  let total = 0;
  for (const child of await readdir(path, { withFileTypes: true })) {
    const childPath = join(path, child.name);
    if (child.isDirectory()) total += await treeBytes(childPath);
    else if (child.isFile()) total += (await stat(childPath)).size;
  }
  return total;
}

async function listNames(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Least-recently-used trim over built entries and model facts files: a hit or a save stamps its entry, so the ones no
 * build has touched for longest go first until the cache fits `maxBytes`. An entry another build removes mid-walk is
 * skipped.
 */
export async function trimCache(cacheDir: string, maxBytes: number): Promise<{ removed: number; bytes: number }> {
  const paths = [
    ...(await listNames(cacheDir)).filter((name) => ENTRY.test(name)).map((name) => join(cacheDir, name)),
    ...(await listNames(join(cacheDir, 'facts')))
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(cacheDir, 'facts', name)),
  ];
  const entries: Array<{ path: string; used: number; bytes: number }> = [];
  for (const path of paths) {
    try {
      const info = await stat(path);
      entries.push({ path, used: info.mtimeMs, bytes: info.isDirectory() ? await treeBytes(path) : info.size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let removed = 0;
  for (const entry of entries.sort((left, right) => left.used - right.used)) {
    if (bytes <= maxBytes) break;
    await rm(entry.path, { recursive: true, force: true });
    bytes -= entry.bytes;
    removed += 1;
  }
  return { removed, bytes };
}

/** Stamp an entry as just used for the LRU trim; one another build's trim already removed is left alone. */
export async function markUsed(path: string): Promise<void> {
  const now = new Date();
  try {
    await utimes(path, now, now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function loadCached(
  identity: CacheIdentity,
  cacheDir: string,
  cwd: string,
  outDir: string,
): Promise<JobResult | null> {
  const directory = join(cacheDir, identity.key);
  let result: JobResult;
  try {
    await assertNoSymlinks(cacheDir, directory);
    result = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')) as JobResult;
    validateGeneratedNames(result);
    const cachedFiles: Array<{ name: string; bytes: Buffer }> = [];
    for (const name of Object.keys(result.files)) {
      const cachedPath = generatedPath(join(directory, 'files'), name);
      await assertNoSymlinks(cacheDir, cachedPath);
      const bytes = await readFile(cachedPath);
      const address = /^([0-9a-f]{64})\.[a-z0-9]+$/.exec(name)?.[1];
      /* An empty file is a failed conversion an older build cached, never a real asset. */
      if (bytes.length === 0 || address !== sha256(bytes) || result.files[name]?.bytes !== bytes.length) return null;
      cachedFiles.push({ name, bytes });
    }
    for (const { name, bytes } of cachedFiles) await writeIfChanged(generatedPath(outDir, name), bytes, cwd);
    await markUsed(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
  return result;
}

/**
 * Writes a fresh build to the output directory, then to the cache. A failed cache write (a full disk, another build's
 * trim racing it) is logged and costs only a later rebuild, never this build.
 */
export async function saveBuilt(
  identity: CacheIdentity,
  cacheDir: string | null,
  cwd: string,
  outDir: string,
  result: FreshJobResult,
  log: (line: string) => void = () => {},
): Promise<JobResult> {
  const { buffers, ...metadata } = result;
  validateGeneratedNames(metadata);
  for (const [name, bytes] of Object.entries(buffers)) {
    await writeIfChanged(generatedPath(outDir, name), bytes, cwd);
  }
  if (cacheDir && Object.values(buffers).every((bytes) => bytes.length > 0)) {
    const directory = join(cacheDir, identity.key);
    try {
      for (const [name, bytes] of Object.entries(buffers)) {
        await writeIfChanged(generatedPath(join(directory, 'files'), name), bytes, cacheDir);
      }
      /* result.json goes last: a reader that finds it finds every file it names (or misses on a hash check). */
      await writeIfChanged(join(directory, 'result.json'), `${JSON.stringify(metadata, null, 2)}\n`, cacheDir);
      await markUsed(directory);
    } catch (error) {
      log(`asset cache write skipped for ${identity.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return metadata;
}
