import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type PlayAreaConfig = false | { tap?: string; minFill?: number; maxOffset?: number };

/** Template games may have no source manifest; their SDK dependency identifies them. */
export function hasPlayAreaCheck(game: string): boolean {
  if (existsSync(join(game, 'gm.manifest.json'))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(game, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>;
    };
    return (
      pkg.dependencies?.['@gm/sdk'] !== undefined &&
      existsSync(join(game, 'index.html')) &&
      existsSync(join(game, 'src/main.ts')) &&
      existsSync(join(game, 'design'))
    );
  } catch {
    return false;
  }
}

/** Find an SDK game between the caller and the workspace root. */
export function findPlayAreaGame(cwd: string, root: string): string | undefined {
  let current = resolve(cwd);
  const boundary = resolve(root);
  for (;;) {
    if (hasPlayAreaCheck(current)) return current;
    if (current === boundary) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Locate the enclosing game's manifest even when its build is nested below the game root. */
export function findPlayAreaConfig(dist: string): PlayAreaConfig {
  let current = resolve(dist);
  for (;;) {
    if (existsSync(join(current, 'gm.manifest.json'))) return readPlayAreaConfig(current);
    const parent = dirname(current);
    if (parent === current) return {};
    current = parent;
  }
}

export function readPlayAreaConfig(game: string): PlayAreaConfig {
  const path = join(game, 'gm.manifest.json');
  if (!existsSync(path)) return {};
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { playArea?: PlayAreaConfig };
  const options = manifest.playArea ?? {};
  if (options === false) return false;
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options) ||
    (options.tap !== undefined && typeof options.tap !== 'string') ||
    (options.minFill !== undefined &&
      (typeof options.minFill !== 'number' ||
        !Number.isFinite(options.minFill) ||
        options.minFill < 0 ||
        options.minFill > 1)) ||
    (options.maxOffset !== undefined &&
      (typeof options.maxOffset !== 'number' ||
        !Number.isFinite(options.maxOffset) ||
        options.maxOffset < 0 ||
        options.maxOffset > 1))
  )
    throw new Error('invalid playArea configuration in gm.manifest.json');
  return options;
}
