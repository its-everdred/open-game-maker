import { JOB_STAGE_WORDS, JOB_WAITING_FOR_ANSWER, type JobStage, type JobState } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, eq, sql } from 'drizzle-orm';

import type { AppEvents } from '../app/events.js';
import { recordTerminalSnapshot, recordTicketLifecycle, type TicketTerminal } from './ticket-lifecycle.js';

const { aiurCursors, aiurEvents, jobProjections } = schema;

export type Lifecycle =
  'queued' | 'retrying' | 'allocated' | 'running' | 'paused' | 'waiting' | 'replaced' | 'completed' | 'cancelled';

export type ProjectionInput = {
  ogmState: JobState;
  lifecycle?: Lifecycle;
  trackerState?: string;
  reasonLabels?: string[];
  spendCapReached?: boolean;
  prMerged?: boolean;
  previous?: { stage: JobStage; text: string };
};

export type Projected = { stage: JobStage; text: string };

const word = (stage: JobStage): Projected => ({ stage, text: JOB_STAGE_WORDS[stage] });

// Tracker states that decide the stage on their own; `todo` and `in-progress` defer to reasons and lifecycle.
const TRACKER_STAGES: Record<string, JobStage> = {
  'budget-exhausted': 'out_of_budget',
  'ci-wait': 'final_tests',
  rework: 'fixing',
  'human-review': 'ready',
  parked: 'parked',
  merging: 'done',
  done: 'done',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

const LIFECYCLE_STAGES: Record<Lifecycle, JobStage> = {
  queued: 'waiting_capacity',
  retrying: 'waiting_capacity',
  waiting: 'waiting_capacity',
  allocated: 'building',
  running: 'building',
  replaced: 'building',
  paused: 'paused',
  completed: 'final_tests',
  cancelled: 'cancelled',
};

// Pure and total. Precedence: OGM terminal states, then the spend cap, then the tracker label, then lifecycle.
// An input nothing here recognises keeps the previous stage and text; it never becomes "failed".
export function projectStage(i: ProjectionInput): Projected {
  if (i.ogmState === 'done' || i.ogmState === 'failed' || i.ogmState === 'cancelled') return word(i.ogmState);
  if (i.ogmState === 'paused_budget') return word('out_of_budget');
  if (i.ogmState === 'queued') return word('queued_ogm');
  if (i.spendCapReached) return word('out_of_budget');
  if (i.prMerged) return word('done');

  const tracker =
    i.trackerState !== undefined && Object.hasOwn(TRACKER_STAGES, i.trackerState)
      ? TRACKER_STAGES[i.trackerState]
      : undefined;
  if (tracker) return word(tracker);

  const reasons = i.reasonLabels ?? [];
  if (reasons.includes('paused-decision')) return { stage: 'paused', text: JOB_WAITING_FOR_ANSWER };
  if (reasons.includes('paused-usage-limit')) return word('waiting_provider');
  if (reasons.includes('paused-agent')) return word('paused');

  if (i.lifecycle !== undefined && Object.hasOwn(LIFECYCLE_STAGES, i.lifecycle))
    return word(LIFECYCLE_STAGES[i.lifecycle]);
  if (i.trackerState === 'in-progress') return word('building');
  if (i.trackerState === 'todo') return word('waiting_capacity');

  return i.previous ?? word('waiting_capacity');
}

// The job a ticket on a daemon belongs to. OGM-013 owns the jobs table and implements this.
export type JobRef = { id: string; state: JobState };
export interface JobDirectory {
  byTicket(daemonSlug: string, ticket: string): JobRef | null;
}

export type ProjectionDeps = {
  db: Db;
  jobs: JobDirectory;
  events: AppEvents;
  lifecycle?: {
    markRunning(jobId: string): void;
    markPaused(jobId: string, reason: 'over_reservation' | 'budget_exhausted'): void;
    markTerminal(jobId: string, state: 'done' | 'failed' | 'cancelled'): void;
  };
  now?: () => Date;
};

// Structural copies of the @ogm/aiur-client record and issue shapes this module reads.
export type FeedRecord =
  | {
      type: 'event';
      seq: number;
      topic: string;
      observed_at: string;
      refs?: Record<string, unknown>;
      payload: Record<string, unknown>;
    }
  | { type: 'gap'; seq: number };

type IssueSide = { state?: unknown; labels?: unknown; run_id?: unknown } | null | undefined;
export type IssueSnapshot = { running?: IssueSide; retry?: IssueSide; idle?: IssueSide };

export type ProgressSnapshot = {
  phase: { status: string; value?: string | null };
  progress: { status: string; percent?: number };
};

type ProjectionRow = typeof jobProjections.$inferSelect;
type Inputs = Pick<
  ProjectionRow,
  'lifecycle' | 'trackerState' | 'reasonLabels' | 'spendCapReached' | 'phase' | 'progressPercent' | 'aiurRunId'
>;

const REASON_SUFFIXES = new Set([
  'merge-queued',
  'ci-red',
  'body-fix',
  'paused-usage-limit',
  'paused-decision',
  'paused-agent',
  'retrying',
  'blocked',
  'handed-off',
]);
const PHASES = new Set(['brainstorm', 'plan', 'work', 'review']);
const TICKET_TOPIC = /^ticket\.([^.]+)\.(.+)$/;

// Applies a page in seq order. Each record commits on its own so the cursor never runs ahead of the rows.
export function applyAiurEvents(deps: ProjectionDeps, daemonSlug: string, records: FeedRecord[]): void {
  for (const record of [...records].sort((a, b) => a.seq - b.seq)) applyAiurEvent(deps, daemonSlug, record);
}

export function applyAiurEvent(
  deps: ProjectionDeps,
  daemonSlug: string,
  record: FeedRecord,
): { applied: boolean; stage?: JobStage } {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const epoch =
    deps.db.select({ epoch: aiurCursors.epoch }).from(aiurCursors).where(eq(aiurCursors.daemonSlug, daemonSlug)).get()
      ?.epoch ?? '';
  let ticketAggregate: ReturnType<typeof recordTicketLifecycle> = 'legacy';
  if (record.type === 'event') {
    const existing = deps.db
      .select({ seq: aiurEvents.seq })
      .from(aiurEvents)
      .where(and(eq(aiurEvents.daemonSlug, daemonSlug), eq(aiurEvents.epoch, epoch), eq(aiurEvents.seq, record.seq)))
      .get();
    if (existing) {
      deps.db.transaction((tx) => advanceCursor(tx, daemonSlug, record.seq, now));
      return { applied: false };
    }

    const match = TICKET_TOPIC.exec(record.topic);
    const ticket = match?.[1];
    const job = ticket === undefined ? null : deps.jobs.byTicket(daemonSlug, ticket);
    const current =
      job === null ? undefined : deps.db.select().from(jobProjections).where(eq(jobProjections.jobId, job.id)).get();
    if (job !== null && ticket !== undefined && !['done', 'failed', 'cancelled'].includes(job.state)) {
      const kind = match?.[2] ?? '';
      const lifecycle = record.payload.lifecycle;
      ticketAggregate =
        kind === 'lifecycle.changed' && typeof lifecycle === 'string'
          ? recordTicketLifecycle(deps.db, job.id, Number(ticket), record.seq, lifecycle)
          : 'legacy';
      if (
        ticketAggregate !== 'stale' &&
        (ticketAggregate !== 'legacy' || current?.lastEventSeq == null || record.seq >= current.lastEventSeq)
      ) {
        applyLifecycle(deps, job.id, kind, record.payload, ticketAggregate);
      }
    }
  }

  const outcome = deps.db.transaction((tx): ApplyOutcome => {
    advanceCursor(tx, daemonSlug, record.seq, now);
    if (record.type === 'gap') return { applied: false };

    const match = TICKET_TOPIC.exec(record.topic);
    const ticket = match?.[1];
    const job = ticket === undefined ? null : deps.jobs.byTicket(daemonSlug, ticket);
    const inserted = tx
      .insert(aiurEvents)
      .values({
        daemonSlug,
        epoch,
        seq: record.seq,
        topic: record.topic,
        ticket: ticket ?? null,
        jobId: job?.id ?? null,
        payload: JSON.stringify(record.payload),
        observedAt: record.observed_at,
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) return { applied: false };
    if (job === null || ticket === undefined) return { applied: true };

    const current = readProjection(tx, job.id);
    if (ticketAggregate === 'stale') return { applied: true, ...(current ? { stage: current.stage as JobStage } : {}) };
    // An event older than the one the row already reflects is stored but does not rewind the stage.
    const older = current?.lastEventSeq != null && record.seq < current.lastEventSeq;
    const aggregateTerminal = ticketAggregate === 'done' || ticketAggregate === 'cancelled';
    if (older && !aggregateTerminal && !['done', 'failed', 'cancelled'].includes(job.state)) {
      return { applied: true, stage: current.stage as JobStage };
    }

    const kind = match?.[2] ?? '';
    const patch = older ? {} : eventPatch(kind, record.payload);
    if (
      kind === 'lifecycle.changed' &&
      ticketAggregate === 'waiting' &&
      ['completed', 'cancelled'].includes(String(record.payload.lifecycle))
    ) {
      patch.lifecycle = 'waiting';
    } else if (aggregateTerminal) {
      patch.lifecycle = ticketAggregate === 'done' ? 'completed' : 'cancelled';
    }
    const runId = record.refs?.job_id;
    if (typeof runId === 'string') patch.aiurRunId = runId;
    const change = writeProjection(tx, {
      daemonSlug,
      ticket,
      job,
      current,
      patch,
      seq: older ? current.lastEventSeq! : record.seq,
      now,
    });
    return { applied: true, stage: change.to, change, ...(kind.startsWith('usage.') ? { usageJob: job.id } : {}) };
  });

  emitChange(deps, outcome.change);
  if (outcome.usageJob !== undefined) deps.events.emit('job.usage.changed', { jobId: outcome.usageJob });
  return { applied: outcome.applied, ...(outcome.stage === undefined ? {} : { stage: outcome.stage }) };
}

function applyLifecycle(
  deps: ProjectionDeps,
  jobId: string,
  kind: string,
  payload: Record<string, unknown>,
  aggregate: ReturnType<typeof recordTicketLifecycle>,
): void {
  if (!deps.lifecycle || kind !== 'lifecycle.changed' || typeof payload.lifecycle !== 'string') return;
  switch (payload.lifecycle) {
    case 'allocated':
    case 'running':
      deps.lifecycle.markRunning(jobId);
      break;
    case 'paused': {
      const value = typeof payload.reason === 'string' ? payload.reason : '';
      if (value === 'over_reservation') deps.lifecycle.markPaused(jobId, 'over_reservation');
      else if (value.includes('budget')) deps.lifecycle.markPaused(jobId, 'budget_exhausted');
      break;
    }
    case 'completed':
      if (aggregate === 'legacy' || aggregate === 'done') deps.lifecycle.markTerminal(jobId, 'done');
      else if (aggregate === 'cancelled') deps.lifecycle.markTerminal(jobId, 'cancelled');
      break;
    case 'cancelled':
      if (aggregate === 'legacy' || aggregate === 'cancelled') deps.lifecycle.markTerminal(jobId, 'cancelled');
      break;
  }
}

type ApplyOutcome = { applied: boolean; stage?: JobStage; change?: StageChange; usageJob?: string };

// A `GET /api/v1/:issue` read: tracker state and reason modifiers from the running, retry or idle entry.
export function applyIssueSnapshot(
  deps: ProjectionDeps,
  daemonSlug: string,
  ticket: string,
  issue: IssueSnapshot,
): JobStage | null {
  return applyPatch(deps, daemonSlug, ticket, issuePatch(issue));
}

// Called only after the tracker has confirmed the ticket's terminal state.
export function applyTerminalSnapshot(
  deps: ProjectionDeps,
  daemonSlug: string,
  ticket: string,
  state: TicketTerminal,
  fence?: number,
): void {
  const job = deps.jobs.byTicket(daemonSlug, ticket);
  if (!job || !deps.lifecycle || ['done', 'failed', 'cancelled'].includes(job.state)) return;
  const aggregate = recordTerminalSnapshot(deps.db, job.id, Number(ticket), state, fence);
  const terminal = aggregate === 'legacy' ? state : aggregate;
  if (terminal !== 'done' && terminal !== 'cancelled') return;
  deps.lifecycle.markTerminal(job.id, terminal);
  applyPatch(deps, daemonSlug, ticket, { lifecycle: terminal === 'done' ? 'completed' : 'cancelled' });
}

// A `/progress` read: phase and percent only.
export function applyProgress(
  deps: ProjectionDeps,
  daemonSlug: string,
  ticket: string,
  progress: ProgressSnapshot,
): JobStage | null {
  const patch: Partial<Inputs> = {};
  if (progress.phase.status === 'known' && progress.phase.value) patch.phase = progress.phase.value;
  if (progress.progress.status === 'known' && progress.progress.percent !== undefined) {
    patch.progressPercent = Math.round(progress.progress.percent);
  }
  return applyPatch(deps, daemonSlug, ticket, patch);
}

export function issuePatch(issue: IssueSnapshot): Partial<Inputs> {
  const side = issue.running ?? issue.retry ?? issue.idle;
  const patch: Partial<Inputs> = {};
  if (!side) return patch;
  if (typeof side.state === 'string') patch.trackerState = normalizeLabel(side.state);
  const labels = Array.isArray(side.labels) ? side.labels.filter((l): l is string => typeof l === 'string') : [];
  patch.reasonLabels = JSON.stringify(labels.map(normalizeLabel).filter((label) => REASON_SUFFIXES.has(label)));
  if (typeof side.run_id === 'string') patch.aiurRunId = side.run_id;
  return patch;
}

// `agent:ci-wait`, `castle-run:ci-wait`, `Agent: CI Wait` and `ci-wait` all read `ci-wait`: the daemon's own label
// prefix (its game slug for a game daemon) is dropped, so projections never depend on which prefix aiur used.
function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/^[^:\s]+:\s*/, '')
    .replace(/\s+/g, '-');
}

function eventPatch(kind: string, payload: Record<string, unknown>): Partial<Inputs> {
  const patch: Partial<Inputs> = {};
  if (kind === 'lifecycle.changed' && typeof payload.lifecycle === 'string') patch.lifecycle = payload.lifecycle;
  if (payload.spend_cap_state === 'budget_exhausted') patch.spendCapReached = true;
  if (kind === 'cancel.result' && payload.process_status === 'exited') patch.trackerState = 'cancelled';
  if (kind.startsWith('agent.progress')) {
    if (typeof payload.phase === 'string' && PHASES.has(payload.phase)) patch.phase = payload.phase;
    if (typeof payload.percent === 'number') patch.progressPercent = Math.round(payload.percent);
  }
  return patch;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type StageChange = { jobId: string; from: JobStage | null; to: JobStage; text: string; changed: boolean };

function applyPatch(deps: ProjectionDeps, daemonSlug: string, ticket: string, patch: Partial<Inputs>): JobStage | null {
  const job = deps.jobs.byTicket(daemonSlug, ticket);
  if (job === null) return null;
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const change = deps.db.transaction((tx) =>
    writeProjection(tx, { daemonSlug, ticket, job, current: readProjection(tx, job.id), patch, now }),
  );
  emitChange(deps, change);
  return change.to;
}

function readProjection(tx: Tx, jobId: string): ProjectionRow | undefined {
  return tx.select().from(jobProjections).where(eq(jobProjections.jobId, jobId)).get();
}

function writeProjection(
  tx: Tx,
  input: {
    daemonSlug: string;
    ticket: string;
    job: JobRef;
    current: ProjectionRow | undefined;
    patch: Partial<Inputs>;
    seq?: number;
    now: string;
  },
): StageChange {
  const { current, patch } = input;
  const merged: Inputs = {
    lifecycle: patch.lifecycle ?? current?.lifecycle ?? null,
    trackerState: patch.trackerState ?? current?.trackerState ?? null,
    reasonLabels: patch.reasonLabels ?? current?.reasonLabels ?? '[]',
    spendCapReached: patch.spendCapReached ?? current?.spendCapReached ?? false,
    phase: patch.phase ?? current?.phase ?? null,
    progressPercent: patch.progressPercent ?? current?.progressPercent ?? null,
    aiurRunId: patch.aiurRunId ?? current?.aiurRunId ?? null,
  };
  const projected = projectStage({
    ogmState: input.job.state,
    ...(merged.lifecycle === null ? {} : { lifecycle: merged.lifecycle as Lifecycle }),
    ...(merged.trackerState === null ? {} : { trackerState: merged.trackerState }),
    reasonLabels: JSON.parse(merged.reasonLabels) as string[],
    spendCapReached: merged.spendCapReached,
    ...(current ? { previous: { stage: current.stage as JobStage, text: current.stageText } } : {}),
  });
  const row = {
    ...merged,
    stage: projected.stage,
    stageText: projected.text,
    lastEventSeq: input.seq ?? current?.lastEventSeq ?? null,
    updatedAt: input.now,
  };
  tx.insert(jobProjections)
    .values({ jobId: input.job.id, daemonSlug: input.daemonSlug, ticket: input.ticket, ...row })
    .onConflictDoUpdate({ target: jobProjections.jobId, set: row })
    .run();
  const from = (current?.stage as JobStage | undefined) ?? null;
  return {
    jobId: input.job.id,
    from,
    to: projected.stage,
    text: projected.text,
    changed: from !== projected.stage || current?.stageText !== projected.text,
  };
}

function advanceCursor(tx: Tx, daemonSlug: string, seq: number, now: string): void {
  tx.insert(aiurCursors)
    .values({ daemonSlug, lastSeq: seq, updatedAt: now })
    .onConflictDoUpdate({
      target: aiurCursors.daemonSlug,
      set: { lastSeq: sql`max(${aiurCursors.lastSeq}, ${seq})`, updatedAt: now },
    })
    .run();
}

// Emitted after commit, only when the stage or its words changed.
function emitChange(deps: ProjectionDeps, change: StageChange | undefined): void {
  if (change === undefined || !change.changed) return;
  deps.events.emit('job.stage.changed', { jobId: change.jobId, from: change.from, to: change.to, text: change.text });
}
