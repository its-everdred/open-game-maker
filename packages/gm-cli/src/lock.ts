import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { ASSETS_SCHEMA_MINOR, AssetsLockSchema, type AssetsLock, type LockEntry } from '@ogm/contracts';

const LOCK_FILE = 'assets.lock.json';

export async function readLock(cwd: string): Promise<AssetsLock | null> {
  const path = join(cwd, LOCK_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  try {
    return AssetsLockSchema.parse(JSON.parse(text));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${LOCK_FILE} is invalid: ${detail}`, { cause: error });
  }
}

export function upsertLock(lock: AssetsLock, entry: LockEntry): AssetsLock {
  const assets = lock.assets.filter((candidate) => candidate.id !== entry.id);
  assets.push(entry);
  assets.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { ...lock, assets };
}

export async function writeLock(cwd: string, lock: AssetsLock): Promise<void> {
  const sorted = {
    ...lock,
    minor: ASSETS_SCHEMA_MINOR,
    assets: [...lock.assets].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  };
  const parsed = AssetsLockSchema.parse(sorted);
  await writeGeneratedText(join(cwd, LOCK_FILE), `${JSON.stringify(parsed, null, 2)}\n`);
}

export async function writeGeneratedText(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}
