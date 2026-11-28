import type { AiurClient } from '@ogm/aiur-client';
import type { Db } from '@ogm/db';

import type { IssuesClient } from '../github/issues.js';
import type { EnsureResult, Fleet } from '../fleet/fleet.js';
import type { DaemonKey } from '../fleet/types.js';

export type FileResult =
  | { filed: true; issues: number[] }
  | { deferred: 'capacity' | 'github' | 'aiur' | 'triage' }
  | { skipped: string }
  | { failed: 'preflight'; reasons: string[] };

export type IntakeAlert = {
  code: 'preflight_failed' | 'github_failed' | 'spend_cap_failed' | 'nudge_failed' | 'sweep_failed';
  jobId: string;
  reasons: string[];
};

export type IntakeDeps = {
  db: Db;
  // A daemon is keyed by the game it builds: the key carries the game's slug and the instance repo it lives in.
  fleet:
    | Pick<Fleet, 'ensureDaemon'>
    | {
        ensureDaemon(key: DaemonKey, kind: 'new_game' | 'feature' | 'repair'): Promise<EnsureResult>;
      };
  issues: IssuesClient;
  // Keyed by the daemon the game resolved to: its own, or the registered daemon its repository shares.
  aiurForGame: (daemonSlug: string) => Promise<Pick<AiurClient, 'setSpendCap' | 'nudgeTodo'>>;
  shippedSkills: readonly string[];
  plannerTicketLimit?: number;
  coreRepo?: string;
  failJob: (jobId: string) => void;
  cancelJob?: (jobId: string) => void;
  subscribeAdmitted?: (listener: (jobId: string) => void) => () => void;
  onJobChanged?: (event: { jobId: string; gameId: string; familyId: string; state: 'filed' | 'paused_budget' }) => void;
  alert?: (event: IntakeAlert) => void | Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  sweepMs?: number;
};
