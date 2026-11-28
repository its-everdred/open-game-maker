import { schema, type Db, type Sqlite } from '@ogm/db';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { AppEvents } from '../app/events.js';
import { getBudgetSettings, type BudgetDefaults } from '../budget/settings.js';
import { SLOT_STATES, transition } from './state.js';

export type SchedulerDeps = {
  db: Db;
  sqlite: Sqlite;
  events: AppEvents;
  defaults: BudgetDefaults;
  now?: () => Date;
  log?: (line: Record<string, unknown>) => void;
};

type Started = { jobId: string; gameId: string; familyId: string; creatorId: string };

function hasPlannerBase(plan: string): boolean {
  try {
    const base = (JSON.parse(plan) as { _plannerBase?: { branch?: unknown; sha?: unknown } })._plannerBase;
    return (
      typeof base?.branch === 'string' &&
      base.branch.length > 0 &&
      typeof base.sha === 'string' &&
      /^[a-f0-9]{40}$/.test(base.sha)
    );
  } catch {
    return false;
  }
}

export function tick(deps: SchedulerDeps, now = (deps.now ?? (() => new Date()))()): string[] {
  const outcome = deps.sqlite
    .transaction((): Started[] => {
      const queued = deps.db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.state, 'queued'),
            or(eq(schema.jobs.start, 'now'), lte(schema.jobs.startAt, now.toISOString())),
          ),
        )
        .orderBy(asc(schema.jobs.createdAt), sql`rowid`)
        .all();
      const accepted: Started[] = [];
      const settingsByFamily = new Map<string, ReturnType<typeof getBudgetSettings>>();

      for (const row of queued) {
        const parentMatch = /^planner:(j_[A-Za-z0-9-]+):[A-Za-z0-9_-]{1,60}$/.exec(row.idempotencyKey ?? '');
        if (parentMatch) {
          const parent = deps.db
            .select({ state: schema.jobs.state })
            .from(schema.jobs)
            .where(eq(schema.jobs.id, parentMatch[1]!))
            .get();
          if (
            !parent ||
            parent.state === 'failed' ||
            parent.state === 'cancelled' ||
            row.aiurIssueNumber === null ||
            !hasPlannerBase(row.plan)
          )
            continue;
        }
        const settings = settingsByFamily.get(row.familyId) ?? getBudgetSettings(deps.db, row.familyId, deps.defaults);
        settingsByFamily.set(row.familyId, settings);
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
        if (held >= settings.slots[row.slot]) continue;
        const state = transition(row.state, 'admit');
        const changed = deps.db
          .update(schema.jobs)
          .set({ state, updatedAt: now.toISOString() })
          .where(and(eq(schema.jobs.id, row.id), eq(schema.jobs.state, 'queued')))
          .run();
        if (changed.changes === 1) {
          accepted.push({ jobId: row.id, gameId: row.gameId, familyId: row.familyId, creatorId: row.creatorId });
        }
      }
      return accepted;
    })
    .immediate();

  for (const job of outcome) {
    deps.events.emit('job.changed', {
      jobId: job.jobId,
      gameId: job.gameId,
      familyId: job.familyId,
      state: 'admitted',
    });
    deps.events.emit('job.started', {
      jobId: job.jobId,
      gameId: job.gameId,
      familyId: job.familyId,
      userIds: [job.creatorId],
    });
  }
  return outcome.map(({ jobId }) => jobId);
}

export function startScheduler(deps: SchedulerDeps, intervalMs = 60_000): () => void {
  let inFlight = false;
  const run = () => {
    if (inFlight) return;
    inFlight = true;
    try {
      tick(deps);
    } catch (error) {
      deps.log?.({ event: 'job-scheduler-error', stack: (error as Error).stack ?? String(error) });
    } finally {
      inFlight = false;
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
