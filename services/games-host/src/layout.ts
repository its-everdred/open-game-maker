import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { pid } from 'node:process';

import { cachePlanSchema, StableIdSchema } from '@ogm/contracts';

const LEGACY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const BLOB_FILE_RE = /^[0-9a-f]{64}\.[a-z0-9]{1,12}$/u;

/* The API's ULID ids (StableIdSchema), plus the lowercase ids (build hashes) already on disk. */
export function isServableId(id: string): boolean {
  return LEGACY_ID_RE.test(id) || StableIdSchema.safeParse(id).success;
}

export class BadId extends Error {
  constructor(id: string) {
    super(`invalid game or build id: ${id}`);
    this.name = 'BadId';
  }
}

export class BadBlobName extends Error {
  constructor(file: string) {
    super(`invalid blob name: ${file}`);
    this.name = 'BadBlobName';
  }
}

export function blobPath(root: string, file: string): string {
  if (!BLOB_FILE_RE.test(file)) {
    throw new BadBlobName(file);
  }
  return join(root, '_a', file);
}

export async function putBlob(root: string, source: string, address = basename(source)): Promise<string> {
  const destination = blobPath(root, address);
  if (await isFile(destination)) {
    return destination;
  }

  const directory = join(root, '_a');
  await mkdir(directory, { recursive: true });
  if (await isFile(destination)) {
    return destination;
  }

  const temporary = join(directory, `.${basename(address)}.${pid}.${randomUUID()}.tmp`);
  try {
    try {
      await link(source, temporary);
    } catch (error) {
      if (!canFallBackToCopy(error)) {
        throw error;
      }
      await copyFile(source, temporary, constants.COPYFILE_EXCL);
    }

    const handle = await open(temporary, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporary, destination);
    await syncDirectory(directory);
    return destination;
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Delete shared blobs absent from every present build's validated cache plan. */
export async function gcBlobs(root: string, liveBuilds: readonly string[]): Promise<void> {
  const live = new Set<string>();
  for (const build of liveBuilds) {
    const raw = await readFile(join(build, 'assets', 'cache-plan.json'), 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (raw === null) continue; // Builds published before cache plans have no shared blob references.
    const plan = cachePlanSchema.parse(JSON.parse(raw) as unknown);
    for (const entry of plan.entries) live.add(entry.sha256);
  }

  const directory = join(root, '_a');
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && BLOB_FILE_RE.test(entry.name) && !live.has(entry.name.slice(0, 64)))
      .map((entry) => rm(join(directory, entry.name))),
  );
}

export function buildDir(root: string, gameId: string, buildId: string): string {
  if (!isServableId(gameId)) {
    throw new BadId(gameId);
  }
  if (!isServableId(buildId)) {
    throw new BadId(buildId);
  }

  return join(root, gameId, buildId);
}

export async function resolveFile(directory: string, urlPath: string): Promise<string | null> {
  const decodedPath = decodeUrlPath(urlPath);
  if (decodedPath === null) {
    return null;
  }

  let segments: string[];
  if (decodedPath === '' || decodedPath === '/') {
    segments = ['index.html'];
  } else {
    if (decodedPath.startsWith('/')) {
      return null;
    }

    segments = decodedPath.split('/');
    if (decodedPath.endsWith('/')) {
      segments[segments.length - 1] = 'index.html';
    }
  }

  if (segments.some(isUnsafeSegment)) {
    return null;
  }

  try {
    const realDirectory = await realpath(directory);
    const candidate = await realpath(join(realDirectory, ...segments));
    const relativePath = relative(realDirectory, candidate);
    if (
      relativePath === '' ||
      isAbsolute(relativePath) ||
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`)
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export async function isComplete(directory: string): Promise<boolean> {
  try {
    return (await stat(join(directory, '.complete'))).isFile();
  } catch {
    return false;
  }
}

export async function markComplete(directory: string): Promise<void> {
  await syncDirectory(directory);

  const marker = join(directory, '.complete');
  const temporaryMarker = join(directory, `.complete.${pid}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporaryMarker, 'wx');
    try {
      await handle.writeFile(`${new Date().toISOString()}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporaryMarker, marker);
    await syncDirectory(directory);
  } finally {
    await rm(temporaryMarker, { force: true });
  }
}

function decodeUrlPath(urlPath: string): string | null {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return null;
  }
}

function isUnsafeSegment(segment: string): boolean {
  return (
    segment.length === 0 ||
    segment.trim().length === 0 ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('\\') ||
    segment.includes('\0')
  );
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function canFallBackToCopy(error: unknown): boolean {
  return ['EACCES', 'EPERM', 'EXDEV', 'ENOSYS', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '');
}
