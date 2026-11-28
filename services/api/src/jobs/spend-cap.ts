import { AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import type { Job } from '@ogm/contracts';
import { schema, type Db, type Sqlite } from '@ogm/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import type { AppEvents } from '../app/events.js';
import { recordAdjustment, releaseReservation } from '../budget/ledger.js';
import { getBudgetSettings, type BudgetDefaults } from '../budget/settings.js';
import { findJob, findJobRow } from './repo.js';
import { SLOT_STATES, transition } from './state.js';

type SpendCapClient = Pick<AiurClient, 'setSpendCap'>;

const jobMutationTails = new Map<string, Promise<void>>();
const capRaisesInProgress = new Set<string>();

export function isCapRaiseInProgress(jobId: string): boolean {
  return capRaisesInProgress.has(jobId);
}

async function withJobMutationLock<T>(jobId: string, operation: () => Promise<T>): Promise<T> {
  const previous = jobMutationTails.get(jobId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const tail = previous.then(() => current);
  jobMutationTails.set(jobId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (jobMutationTails.get(jobId) === tail) jobMutationTails.delete(jobId);
  }
}

export type LifecycleDeps = {
  db: Db;
  sqlite: Sqlite;
  events: AppEvents;
  defaults: BudgetDefaults;
  now?: () => Date;
};

function nowFor(deps: LifecycleDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

function emitState(deps: LifecycleDeps, job: ReturnType<typeof findJobRow>): void {
  deps.events.emit('job.changed', {
    jobId: job.id,
    gameId: job.gameId,
    familyId: job.familyId,
    state: job.state,
  });
}

export function toUsdString(microUsd: number): string {
  if (!Number.isSafeInteger(microUsd) || microUsd < 0) throw new TypeError('microUsd must be a non-negative integer');
  const whole = Math.floor(microUsd / 1_000_000);
  return `${whole}.${String(microUsd % 1_000_000).padStart(6, '0')}`;
}

export async function markFiled(
  deps: LifecycleDeps,
  jobId: string,
  ticket: { repo: string; issueNumber: number },
  aiur: SpendCapClient,
): Promise<Job> {
  return withJobMutationLock(jobId, async () => {
    const row = findJobRow(deps.db, jobId);
    if (
      (row.aiurRepo !== null && row.aiurRepo !== ticket.repo) ||
      (row.aiurIssueNumber !== null && row.aiurIssueNumber !== ticket.issueNumber)
    ) {
      throw new HttpError(409, 'job_ticket_mismatch');
    }
    if (row.state === 'filed' && row.aiurSpendCapMicroUsd === row.hardCapMicroUsd) return findJob(deps.db, jobId);
    if (row.state !== 'admitted') transition(row.state, 'file');

    const updatedAt = nowFor(deps).toISOString();
    deps.db
      .update(schema.jobs)
      .set({ aiurRepo: ticket.repo, aiurIssueNumber: ticket.issueNumber, updatedAt })
      .where(eq(schema.jobs.id, jobId))
      .run();

    try {
      await aiur.setSpendCap(String(ticket.issueNumber), toUsdString(row.hardCapMicroUsd));
    } catch {
      throw new HttpError(502, 'spend_cap_failed');
    }

    const state = transition(row.state, 'file');
    deps.db
      .update(schema.jobs)
      .set({ state, aiurSpendCapMicroUsd: row.hardCapMicroUsd, updatedAt })
      .where(eq(schema.jobs.id, jobId))
      .run();
    const stored = findJobRow(deps.db, jobId);
    emitState(deps, stored);
    return findJob(deps.db, jobId);
  });
}

export function markRunning(deps: LifecycleDeps, jobId: string): Job {
  const row = findJobRow(deps.db, jobId);
  if (row.state === 'running') return findJob(deps.db, jobId);
  const stagedPlanner =
    row.state === 'admitted' && row.aiurIssueNumber !== null && (row.idempotencyKey ?? '').startsWith('planner:');
  const state = stagedPlanner ? 'running' : transition(row.state, row.state === 'paused_budget' ? 'resume' : 'run');
  deps.db
    .update(schema.jobs)
    .set({ state, pausedReason: null, updatedAt: nowFor(deps).toISOString() })
    .where(eq(schema.jobs.id, jobId))
    .run();
  const stored = findJobRow(deps.db, jobId);
  emitState(deps, stored);
  return findJob(deps.db, jobId);
}

export function markPaused(deps: LifecycleDeps, jobId: string, reason: NonNullable<Job['pausedReason']>): Job {
  const row = findJobRow(deps.db, jobId);
  if (row.state === 'paused_budget') {
    if (row.pausedReason !== reason) {
      deps.db
        .update(schema.jobs)
        .set({ pausedReason: reason, updatedAt: nowFor(deps).toISOString() })
        .where(eq(schema.jobs.id, jobId))
        .run();
    }
    return findJob(deps.db, jobId);
  }
  const state = transition(row.state, 'pause');
  deps.db
    .update(schema.jobs)
    .set({ state, pausedReason: reason, updatedAt: nowFor(deps).toISOString() })
    .where(eq(schema.jobs.id, jobId))
    .run();
  const stored = findJobRow(deps.db, jobId);
  emitState(deps, stored);
  return findJob(deps.db, jobId);
}

export function markTerminal(
  deps: LifecycleDeps,
  jobId: string,
  terminal: 'done' | 'failed' | 'cancelled',
  options: { deferRelease?: boolean } = {},
): Job {
  const row = findJobRow(deps.db, jobId);
  const changed = row.state !== terminal;
  const at = nowFor(deps);
  deps.sqlite
    .transaction(() => {
      if (changed) {
        const event = terminal === 'done' ? 'finish' : terminal === 'failed' ? 'fail' : 'cancel';
        const stagedPlanner =
          row.state === 'admitted' && row.aiurIssueNumber !== null && (row.idempotencyKey ?? '').startsWith('planner:');
        const state = stagedPlanner && terminal === 'done' ? 'done' : transition(row.state, event);
        deps.db
          .update(schema.jobs)
          .set({ state, terminalAt: at.toISOString(), updatedAt: at.toISOString() })
          .where(eq(schema.jobs.id, jobId))
          .run();
      }
      if (!options.deferRelease) {
        const settings = getBudgetSettings(deps.db, row.familyId, deps.defaults);
        const release = deps.db
          .update(schema.jobs)
          .set({ releasedAt: at.toISOString(), updatedAt: at.toISOString() })
          .where(and(eq(schema.jobs.id, jobId), isNull(schema.jobs.releasedAt)))
          .run();
        if (release.changes === 1) releaseReservation({ db: deps.db, jobId, at, zone: settings.resetZone });
      }
    })
    .immediate();
  const stored = findJobRow(deps.db, jobId);
  if (changed) emitState(deps, stored);
  return findJob(deps.db, jobId);
}

export async function raiseCap(
  deps: LifecycleDeps,
  jobId: string,
  amountMicroUsd: number,
  aiur: SpendCapClient,
): Promise<Job> {
  return withJobMutationLock(jobId, async () => {
    const row = findJobRow(deps.db, jobId);
    if (!Number.isSafeInteger(amountMicroUsd) || amountMicroUsd <= row.hardCapMicroUsd) {
      throw new HttpError(409, 'cap_not_increased');
    }
    if (!['filed', 'running', 'paused_budget'].includes(row.state)) throw new HttpError(409, 'job_not_active');
    if (row.aiurIssueNumber === null) throw new HttpError(409, 'job_not_filed');
    const settings = getBudgetSettings(deps.db, row.familyId, deps.defaults);
    let slotClaimed = false;
    let committed = false;
    capRaisesInProgress.add(jobId);
    try {
      if (row.releasedAt !== null) {
        const releasedAt = row.releasedAt;
        slotClaimed = deps.sqlite
          .transaction(() => {
            const held = deps.db
              .select({ id: schema.jobs.id })
              .from(schema.jobs)
              .where(
                and(
                  eq(schema.jobs.familyId, row.familyId),
                  eq(schema.jobs.slot, row.slot),
                  inArray(schema.jobs.state, SLOT_STATES),
                  isNull(schema.jobs.releasedAt),
                ),
              )
              .all().length;
            if (held >= settings.slots[row.slot]) return false;
            return (
              deps.db
                .update(schema.jobs)
                .set({ releasedAt: null, updatedAt: nowFor(deps).toISOString() })
                .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.releasedAt, releasedAt)))
                .run().changes === 1
            );
          })
          .immediate();
        if (!slotClaimed) throw new HttpError(409, 'slot_unavailable');
      }

      try {
        await aiur.setSpendCap(String(row.aiurIssueNumber), toUsdString(amountMicroUsd));
      } catch (error) {
        if (error instanceof AiurHttpError && error.status === 409 && error.code === 'spend_cap_exhausted') {
          deps.db
            .update(schema.jobs)
            .set({ pausedReason: 'budget_exhausted', updatedAt: nowFor(deps).toISOString() })
            .where(eq(schema.jobs.id, jobId))
            .run();
          throw new HttpError(409, 'cap_exhausted_upstream');
        }
        throw new HttpError(502, 'spend_cap_failed');
      }

      const at = nowFor(deps);
      const delta = amountMicroUsd - row.hardCapMicroUsd;
      const nextState = row.state === 'paused_budget' ? transition(row.state, 'resume') : row.state;
      deps.sqlite
        .transaction(() => {
          recordAdjustment({
            db: deps.db,
            jobId,
            amountMicroUsd: delta,
            note: 'admin cap raise',
            at,
            zone: settings.resetZone,
          });
          deps.db
            .update(schema.jobs)
            .set({
              state: nextState,
              pausedReason: nextState === 'running' ? null : row.pausedReason,
              hardCapMicroUsd: amountMicroUsd,
              aiurSpendCapMicroUsd: amountMicroUsd,
              updatedAt: at.toISOString(),
            })
            .where(eq(schema.jobs.id, jobId))
            .run();
        })
        .immediate();
      committed = true;
      const stored = findJobRow(deps.db, jobId);
      if (stored.state !== row.state) emitState(deps, stored);
      deps.events.emit('budget.changed', { familyId: stored.familyId, userId: stored.creatorId });
      return findJob(deps.db, jobId);
    } finally {
      if (slotClaimed && !committed) {
        deps.db
          .update(schema.jobs)
          .set({ releasedAt: row.releasedAt, updatedAt: nowFor(deps).toISOString() })
          .where(
            and(
              eq(schema.jobs.id, jobId),
              eq(schema.jobs.state, row.state),
              eq(schema.jobs.hardCapMicroUsd, row.hardCapMicroUsd),
              isNull(schema.jobs.releasedAt),
            ),
          )
          .run();
      }
      capRaisesInProgress.delete(jobId);
    }
  });
}
