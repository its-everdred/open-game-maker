import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CommandError } from './command.js';
import { gameDir, workspaceRoot } from './outbox.js';

type JsonObject = Record<string, unknown>;

function readJson(path: string): JsonObject | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new CommandError(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as JsonObject;
  } catch {
    // Report one stable error below for invalid JSON and non-object JSON alike.
  }
  throw new CommandError(`${path} is not valid game context JSON`);
}

function booleanSetting(value: unknown, path: string): boolean {
  if (value === undefined) return true;
  if (typeof value === 'boolean') return value;
  throw new CommandError(`${path} has an invalid allowAiGeneratedAssets setting`);
}

/** The job bundle is authoritative; a host checkout carries the same preference in `.gm/game.json`. */
export function allowsAiGeneratedAssets(cwd: string): boolean {
  let root: string;
  try {
    root = workspaceRoot(cwd);
  } catch {
    // A library-only invocation outside a game workspace has no per-game preference.
    return true;
  }

  const bundlePath = join(root, '.gm', 'context', 'bundle.json');
  const bundle = readJson(bundlePath);
  if (bundle !== undefined) {
    const context = bundle.gameContext;
    if (context !== undefined && (typeof context !== 'object' || context === null || Array.isArray(context))) {
      throw new CommandError(`${bundlePath} has invalid gameContext`);
    }
    return booleanSetting((context as JsonObject | undefined)?.allowAiGeneratedAssets, bundlePath);
  }

  const gamePath = join(gameDir(cwd, root), '.gm', 'game.json');
  const game = readJson(gamePath);
  // Older games predate the preference, whose documented default is on.
  return booleanSetting(game?.allowAiGeneratedAssets, gamePath);
}
