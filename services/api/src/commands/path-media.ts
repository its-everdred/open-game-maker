import { constants } from 'node:fs';
import { open, readlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { DecisionMediaFile } from '@ogm/aiur-client';
import type { AppDeps } from '../app/types.js';

export type MediaScope = { owner: string; name: string; ticket: string; workspaceRoot?: string };

function inside(root: string, file: string): boolean {
  const part = relative(root, file);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

// A daemon's path is data, not permission to read arbitrary host files. Restrict it to this ticket's review directory,
// resolve symlinks, then check the opened descriptor as well so a changed symlink cannot escape the directory.
export async function pathMedia(
  deps: AppDeps,
  scope: MediaScope,
  path: string,
  mime: string,
  limit: number,
): Promise<DecisionMediaFile> {
  if (
    !/^[a-zA-Z0-9_.-]+$/u.test(scope.owner) ||
    !/^[a-zA-Z0-9_.-]+$/u.test(scope.name) ||
    !/^[1-9][0-9]*$/u.test(scope.ticket) ||
    !isAbsolute(path)
  )
    throw new Error('invalid media scope');
  if ([scope.owner, scope.name].some((part) => part === '.' || part === '..')) throw new Error('invalid media scope');
  const roots = [scope.workspaceRoot, deps.config.builderWorkspacesRoot, join(homedir(), '.aiur', 'w')].filter(
    (root): root is string => Boolean(root),
  );
  const root = roots.find((candidate) =>
    inside(join(candidate, scope.owner, scope.name, scope.ticket, 'review', scope.ticket), path),
  );
  if (!root) throw new Error('media outside review directory');
  const directory = join(root, scope.owner, scope.name, scope.ticket, 'review', scope.ticket);
  if (!inside(directory, path)) throw new Error('media outside review directory');
  const resolvedDirectory = await realpath(directory);
  const canonicalRoot = await realpath(root);
  if (resolvedDirectory !== join(canonicalRoot, scope.owner, scope.name, scope.ticket, 'review', scope.ticket))
    throw new Error('invalid review directory');
  const resolvedPath = await realpath(path);
  if (!inside(resolvedDirectory, resolvedPath)) throw new Error('media outside review directory');
  const handle = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const actual = await readlink(`/proc/self/fd/${handle.fd}`);
    const stat = await handle.stat();
    if (!inside(resolvedDirectory, actual) || !stat.isFile() || stat.nlink !== 1 || stat.size > limit)
      throw new Error('invalid media file');
    return { mime, body: Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array> };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
