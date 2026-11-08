import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from '../command.js';

/** The set recorded in a game's `gm.lock.json`, or undefined when there is no lock or no set; an invalid set throws. */
export function recordedSet(repoDir: string): string | undefined {
  const lockPath = join(repoDir, 'gm.lock.json');
  if (!existsSync(lockPath)) return undefined;
  let lock: unknown;
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    throw new UsageError('gm.lock.json is not valid JSON', 'repair the creation lock before syncing skills');
  }
  if (!lock || typeof lock !== 'object' || !('set' in lock)) return undefined;
  const set = (lock as { set?: unknown }).set;
  if (typeof set !== 'string' || !/^[a-z0-9-]+$/.test(set)) {
    throw new UsageError('gm.lock.json has an invalid set', 'choose a registered lowercase set id');
  }
  return set;
}
