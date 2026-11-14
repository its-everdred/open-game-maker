import { realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** Resolve only regular files within the actual game build, including through symlinks. */
export function captureFile(dist: string, suffix: string): string | null {
  try {
    const root = realpathSync(dist);
    const file = realpathSync(resolve(root, suffix));
    return file.startsWith(`${root}${sep}`) && statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** A URL path is percent-encoded; resolve its decoded form with the same containment check. */
export function captureUrlFile(dist: string, suffix: string): string | null {
  try {
    return captureFile(dist, decodeURIComponent(suffix));
  } catch {
    return null;
  }
}
