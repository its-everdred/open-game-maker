import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CommandError } from './command.js';
import type { GmContext } from './command.js';
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

/** Daemon jobs read the live preference; host checkouts use their stored game settings. */
export async function allowsAiGeneratedAssets(ctx: GmContext): Promise<boolean> {
  const { cwd } = ctx;
  let root: string;
  try {
    root = workspaceRoot(cwd);
  } catch {
    return true;
  }
  const bundlePath = join(root, '.gm', 'context', 'bundle.json');
  const bundle = readJson(bundlePath);
  if (bundle === undefined && existsSync(join(root, '.gm', 'context', 'bundle.missing'))) {
    throw new CommandError('cannot read live AI-generated asset preference');
  }
  if (ctx.blobApi && bundle !== undefined) {
    try {
      if (typeof bundle.gameId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(bundle.gameId)) throw new Error('invalid game');
      const secret = readFileSync(ctx.blobApi.secretFile, 'utf8').trim();
      const response = await fetch(new URL(`/internal/games/${bundle.gameId}/ai-assets`, ctx.blobApi.url), {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error('preference request failed');
      const body = (await response.json()) as JsonObject;
      if (typeof body.allowAiGeneratedAssets !== 'boolean') throw new Error('invalid preference');
      return body.allowAiGeneratedAssets;
    } catch {
      throw new CommandError('cannot read live AI-generated asset preference');
    }
  }
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
