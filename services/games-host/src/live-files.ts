import { constants } from 'node:fs';
import { open, readlink, realpath, type FileHandle } from 'node:fs/promises';
import { join, sep } from 'node:path';

const versionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Select a generation once so all of one page load stays on the same build. */
export async function liveGeneration(liveRoot: string): Promise<string | null> {
  try {
    if ((await realpath(liveRoot)) !== liveRoot) return null;
    const pointer = await readlink(join(liveRoot, 'current'));
    const match = /^versions\/(.+)$/u.exec(pointer);
    const version = match?.[1];
    if (!version || !versionPattern.test(version)) return null;
    const generation = join(liveRoot, 'versions', version);
    return (await realpath(generation)) === generation ? version : null;
  } catch {
    return null;
  }
}

/** Open a file from the selected workspace generation without following a worker-controlled file link. */
export async function openLiveFile(liveRoot: string, path: string, version?: string): Promise<FileHandle | null> {
  const segments = (path || 'index.html').split('/');
  if (segments.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')))
    return null;
  try {
    const root = await realpath(liveRoot);
    if (root !== liveRoot) return null;
    const selected = version ?? (await liveGeneration(root));
    if (!selected || !versionPattern.test(selected)) return null;
    const generation = join(root, 'versions', selected);
    if ((await realpath(generation)) !== generation) return null;
    const file = await open(
      join(generation, ...segments),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const actual = await readlink(`/proc/self/fd/${file.fd}`);
      const info = await file.stat();
      if (!actual.startsWith(generation + sep) || !info.isFile() || info.nlink !== 1) {
        await file.close();
        return null;
      }
      return file;
    } catch (error) {
      await file.close();
      throw error;
    }
  } catch {
    return null;
  }
}
