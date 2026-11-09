/**
 * The multi-client run's choices: how many seats, which link seed, and which start configuration the room is created
 * with. Pure, so the CLI and the scenario agree on what each choice means without a browser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TeamPolicySchema } from '@ogm/contracts';
import { z } from 'zod';

export const MIN_CLIENTS = 2;
export const MAX_CLIENTS = 4;

/** Parses `--clients`; undefined means the four-seat run. */
export function parseClients(value: string | number | undefined): number {
  if (value === undefined) return MAX_CLIENTS;
  const clients = Number(value);
  if (!Number.isInteger(clients) || clients < MIN_CLIENTS || clients > MAX_CLIENTS) {
    throw new Error(`--clients must be ${MIN_CLIENTS}, 3 or ${MAX_CLIENTS}, not ${String(value)}`);
  }
  return clients;
}

/** Parses `--seed`: the link profile's seed is a uint32. */
export function parseSeed(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(seed) || seed > 4_294_967_295) {
    throw new Error(`--seed must be a whole number from 0 to 4294967295, not ${value}`);
  }
  return seed;
}

/**
 * Step 6 on `clients` seats: one seat drops for 3 s and rejoins, another drops past the window and forfeits. Seat 0 is
 * the primary and never drops. Two seats have one peer only: it rejoins, and the forfeit is skipped, because forfeiting
 * the only peer would end the match rather than prove the room outlives a forfeit.
 */
export function dropPlan(clients: number): { rejoin: number; forfeit?: number } {
  const rejoin = Math.min(2, clients - 1);
  const forfeit = clients >= 3 ? (clients === 4 ? 3 : 1) : undefined;
  return forfeit === undefined ? { rejoin } : { rejoin, forfeit };
}

export const NO_FORFEIT = 'seat forfeit (a two-seat room has no second peer to forfeit)';

/**
 * The room options a game may choose for a run: only those the run checks took effect (step 1 compares every seat's team
 * with {@link expectedTeam}), so a start can never be reported that the room ignored. Authority mode is not one of them:
 * the game's manifest already sets it and the room is always created with that.
 */
export const startConfigSchema = z.strictObject({ teams: TeamPolicySchema.optional() });
export type StartConfig = z.infer<typeof startConfigSchema>;

/** Where a game names its start configurations: `{ "<name>": { "teams": "alternate" } }`. */
export const STARTS_FILE = join('qa', 'starts.json');

/** Reads the start configuration `name` from the game's `qa/starts.json`. */
export function readStart(gameDir: string, name: string): StartConfig {
  const path = join(gameDir, STARTS_FILE);
  if (!existsSync(path)) throw new Error(`--start ${name}: the game has no ${STARTS_FILE}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (caught) {
    throw new Error(`${STARTS_FILE} is not valid JSON: ${caught instanceof Error ? caught.message : String(caught)}`, {
      cause: caught,
    });
  }
  const starts = z.record(z.string(), startConfigSchema).safeParse(raw);
  if (!starts.success) {
    const issues = starts.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`${STARTS_FILE} is invalid (${issues}); an entry may set only "teams": "none" or "alternate"`);
  }
  const start = Object.hasOwn(starts.data, name) ? starts.data[name] : undefined;
  if (start === undefined) {
    throw new Error(
      `--start ${name} is not in ${STARTS_FILE} (it names ${Object.keys(starts.data).join(', ') || 'none'})`,
    );
  }
  return start;
}

/** The report's record of the start: its name and each option it passed to the room. */
export function startProbes(name: string, start: StartConfig): Record<string, string> {
  return { start: name, ...(start.teams === undefined ? {} : { 'start.teams': start.teams }) };
}

/** The team the room must give `seat` under `policy` (services/rooms `teamOf`): alternate is seat n → team n % 2. */
export function expectedTeam(seat: number, policy: StartConfig['teams'] = 'none'): number {
  return policy === 'alternate' ? seat % 2 : 0;
}

/** The room-create body: the start's options, under the run's own pin, owner, seats, protocol and authority mode. */
export function roomBody<T extends object>(base: T, start: StartConfig | undefined): StartConfig & T {
  return { ...start, ...base };
}
