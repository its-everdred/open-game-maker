import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { parse } from 'yaml';

// Resolve existing ancestors too, so a symlink cannot disguise an overlap with a future workspace.
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // An existing dangling symlink has an unknown destination and must not be treated as a new directory.
    try {
      await lstat(path);
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
      const parent = dirname(path);
      if (parent === path) throw error;
      return join(await canonical(parent), relative(parent, path));
    }
    throw error;
  }
}

function pathFor(value: unknown, home: string): string {
  if (typeof value !== 'string' || !value || /[*?[\]]/.test(value)) throw new Error('invalid path');
  const path = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
  if (!isAbsolute(path)) throw new Error('path is not absolute');
  return resolve(path);
}

function overlaps(a: string, b: string): boolean {
  const rel = relative(a, b);
  return rel === '' || (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel));
}

export async function externalPreflight(checkout: string, home: string, workspaces: string[]): Promise<string[]> {
  try {
    const config = parse(await readFile(join(checkout, '.aiur/config'), 'utf8'));
    const root: unknown = config?.workspace?.root;
    const writable: unknown = config?.agent?.codex?.turn_sandbox_policy?.writableRoots;
    if (!Array.isArray(writable)) throw new Error('missing writableRoots');
    const external = await Promise.all([root, ...writable].map((path) => canonical(pathFor(path, home))));
    const targets = await Promise.all(workspaces.map((path) => canonical(resolve(path))));
    if (external.some((path) => targets.some((target) => overlaps(path, target) || overlaps(target, path)))) {
      return ['external daemon workspace or writableRoots overlaps a managed workspace'];
    }
    return [];
  } catch {
    return ['cannot verify external daemon workspace and writableRoots'];
  }
}

export async function sameDirectory(a: string, b: string): Promise<boolean> {
  return (await canonical(resolve(a))) === (await canonical(resolve(b)));
}
