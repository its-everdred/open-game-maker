import { HttpError } from '../app/errors.js';
import type { LogLine } from '../app/types.js';

export type IncompleteSources = { repo?: string; daemon?: string; lookup?: number; tracker?: string };

// The last failing sources logged per game: the app polls every 5 seconds, so a lasting failure logs once, when it
// starts or changes, and a recovery clears it.
const lastLogged = new Map<string, string>();

export function logIncomplete(log: (line: LogLine) => void, gameId: string, sources: IncompleteSources): void {
  const key = JSON.stringify(sources);
  if ((lastLogged.get(gameId) ?? '{}') === key) return;
  if (key === '{}') {
    lastLogged.delete(gameId);
    return;
  }
  lastLogged.set(gameId, key);
  log({ event: 'game_workers_incomplete', gameId, ...sources });
}

export function sourceError(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && 'status' in error && typeof error.status === 'number')
    return `${error.name}:${error.status}`;
  return error instanceof Error ? error.name : 'unknown';
}
