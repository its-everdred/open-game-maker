import type { JobKind } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

import { listCommands, parseCommand } from '../build-chat/store.js';

export type CommandBudget = { used: number; max: 1 | 3 };

export function commandBudget(sqlite: Sqlite, jobId: string, kind: JobKind): CommandBudget {
  return {
    used: listCommands(sqlite, jobId).filter((row) => parseCommand(row)?.status !== 'moot').length,
    max: kind === 'new_game' ? 3 : 1,
  };
}
