import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { readQaManifest, saveQaManifest, unknownQaGames, type QaManifest } from './qa-new-game-manifest.js';
import type { CreatedGame } from './qa-new-game-steps.js';

export type NewGameCaptureResult = {
  viewport: string;
  ok: boolean;
  failures: string[];
  stills: string[];
  mp4: string | null;
};
export type NewGameRunServices = {
  inventory(): Promise<string[]>;
  cleanup(gameId: string, run: string, ready: () => Promise<void>): Promise<void>;
  release?(gameId: string, run: string): Promise<void>;
  capture(created: (game: CreatedGame) => Promise<void>): Promise<NewGameCaptureResult[]>;
};

/** Keep the game IDs durable before continuing and never guess which unexplained QA row belongs to this run. */
export async function runNewGameQa(
  config: { out: string; repo: string; run: string; legacyIds?: readonly string[] },
  services: NewGameRunServices,
) {
  await mkdir(config.out, { recursive: true });
  const path = join(config.out, 'state.json');
  const failures: string[] = [];
  const results: NewGameCaptureResult[] = [];
  let state = await readQaManifest(path, config.repo);
  async function inventory(): Promise<string[]> {
    const ids = await services.inventory();
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== 'string' || !/^g_[A-Za-z0-9_-]+$/u.test(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error('invalid QA inventory');
    return ids;
  }
  async function cleanupRecorded(current: QaManifest): Promise<boolean> {
    const ids = await inventory();
    const unknown = unknownQaGames(current, ids).filter((id) => !config.legacyIds?.includes(id));
    if (unknown.length) {
      failures.push(`unidentified QA games require inspection: ${unknown.join(', ')}`);
      return false;
    }
    for (const game of current.games.filter((entry) => !entry.cleaned)) {
      if (!ids.includes(game.id)) {
        if (game.deleteReady) {
          try {
            await services.release?.(game.id, current.run);
          } catch {
            failures.push(`QA game ${game.id} fence release failed`);
            continue;
          }
          game.cleaned = true;
          await saveQaManifest(path, current);
          continue;
        }
        failures.push(`QA game ${game.id} disappeared before cleanup could be verified`);
        continue;
      }
      try {
        await services.cleanup(game.id, current.run, async () => {
          game.deleteReady = true;
          await saveQaManifest(path, current);
        });
        game.cleaned = true;
        await saveQaManifest(path, current);
      } catch (error) {
        failures.push(
          `QA game ${game.id} cleanup: ${error instanceof Error ? error.message.split('\n')[0] : 'failed'}`,
        );
      }
    }
    return current.games.every((game) => game.cleaned);
  }
  if (state && !state.complete) {
    if (!(await cleanupRecorded(state))) return { ok: false, results, failures };
    state.complete = true;
    await saveQaManifest(path, state);
  }
  let existing = await inventory();
  for (const id of config.legacyIds ?? []) {
    if (!existing.includes(id)) {
      try {
        await services.release?.(id, `legacy-${id.slice(-8).toLowerCase()}`);
      } catch {
        failures.push(`QA game ${id} fence release failed`);
      }
      continue;
    }
    try {
      await services.cleanup(id, `legacy-${id.slice(-8).toLowerCase()}`, async () => undefined);
    } catch (error) {
      failures.push(`QA game ${id} cleanup: ${error instanceof Error ? error.message.split('\n')[0] : 'failed'}`);
    }
  }
  existing = await inventory();
  state = { version: 1, repo: config.repo, run: config.run, baseline: existing, games: [], complete: false };
  await saveQaManifest(path, state);
  try {
    results.push(
      ...(await services.capture(async (game) => {
        if (state!.baseline.includes(game.id) || state!.games.some((item) => item.id === game.id))
          throw new Error('created game ID is not new to this run');
        state!.games.push({ ...game, cleaned: false, deleteReady: false });
        await saveQaManifest(path, state!);
      })),
    );
  } catch (error) {
    failures.push(`QA capture: ${error instanceof Error ? error.message.split('\n')[0] : 'failed'}`);
  }
  const cleaned = await cleanupRecorded(state);
  if (cleaned) {
    state.complete = true;
    await saveQaManifest(path, state);
  }
  if (results.length !== 2) failures.push('both phone orientations were not completed');
  return { ok: failures.length === 0 && results.every((result) => result.ok), results, failures };
}
