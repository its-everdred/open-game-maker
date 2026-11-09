import type {
  AiurClient,
  ExportedEvent,
  GapRecord,
  IssueEntry,
  subscribeEvents,
  TicketProgress,
} from '@ogm/aiur-client';
import type { Db } from '@ogm/db';

import type { DaemonStatus, GameDaemon } from '../fleet/types.js';

export const FEED_PATTERNS = [
  'ticket.*.lifecycle.changed',
  'ticket.*.usage.*',
  'ticket.*.cancel.result',
  'ticket.*.agent.progress*',
];

export const INTERVALS = {
  reconcileMs: 10_000,
  progressMs: 30_000,
  issueMs: 60_000,
  decisionsMs: 15_000,
};

// The slice of OGM-034's fleet the feed needs.
export type FeedFleet = {
  listDaemons(status?: DaemonStatus): Promise<GameDaemon[]>;
  daemonFor(gameSlug: string): Promise<{ daemon: GameDaemon; client: AiurClient } | null>;
};

// A job filed on a daemon and not yet terminal. OGM-013 owns the jobs table and implements this.
export type ActiveJob = { jobId: string; ticket: string };
export type ActiveJobsFor = (daemonSlug: string) => ActiveJob[] | Promise<ActiveJob[]>;

// The projection writers in @ogm/api (services/api/src/jobs/projection.ts), bound to their deps by the host.
export type FeedApply = {
  record(daemonSlug: string, record: ExportedEvent | GapRecord): void;
  issue(daemonSlug: string, ticket: string, issue: IssueEntry): void;
  progress(daemonSlug: string, ticket: string, progress: TicketProgress): void;
};

export type CommandEvent = { kind: 'command.requested' | 'command.answered'; jobId: string; decisionId: string };

export type FeedDeps = {
  fleet: FeedFleet;
  db: Db;
  activeJobs: ActiveJobsFor;
  apply: FeedApply;
  subscribe?: typeof subscribeEvents;
  alert?: (message: string) => void;
  log?: (line: Record<string, unknown>) => void;
  emit?: (event: CommandEvent) => void;
  now?: () => Date;
  intervals?: Partial<typeof INTERVALS>;
};

export type RunningDaemon = { slug: string; client: AiurClient };

// `unit` is `ogm-aiur@<slug>.service` (fleet/systemctl.ts); the row's own slug is the fallback, never the repository.
export function daemonSlug(daemon: GameDaemon): string {
  return /^ogm-aiur@(.+)\.service$/.exec(daemon.unit)?.[1] ?? daemon.slug;
}
