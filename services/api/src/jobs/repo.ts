import { JobPlan, Reservation, type CreateJobAccepted, type Job, type JobState } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { daemonRowForGame } from './daemons.js';
import { jobHasOutstandingWork } from './creator-slot.js';
import { SLOT_STATES } from './state.js';

export type JobRow = typeof schema.jobs.$inferSelect;

export function toJob(
  row: JobRow,
  projection?: typeof schema.jobProjections.$inferSelect | null,
  openRequestCount = 0,
  position?: number,
): Job {
  return {
    id: row.id,
    gameId: row.gameId,
    branchId: row.branchId,
    familyId: row.familyId,
    creatorId: row.creatorId,
    kind: row.kind,
    complexity: row.complexity,
    state: row.state,
    pausedReason: row.pausedReason,
    start: row.start,
    startAt: row.startAt,
    slot: row.slot,
    plan: JobPlan.parse(JSON.parse(row.plan)),
    reservation: Reservation.parse(JSON.parse(row.reservation)),
    hardCapMicroUsd: row.hardCapMicroUsd,
    usageMicroUsd: row.usageMicroUsd,
    aiurRepo: row.aiurRepo,
    aiurIssueNumber: row.aiurIssueNumber,
    aiurSpendCapMicroUsd: row.aiurSpendCapMicroUsd,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    terminalAt: row.terminalAt,
    ...(projection ? { stage: projection.stage as Job['stage'], stageText: projection.stageText } : {}),
    ...(projection?.phase ? { phase: projection.phase as Job['phase'] } : {}),
    ...(projection?.progressPercent === null || projection?.progressPercent === undefined
      ? {}
      : { progressPercent: projection.progressPercent }),
    openRequestCount,
    ...(position === undefined ? {} : { position }),
  };
}

export function findJobRow(db: Db, id: string): JobRow {
  const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
  if (!row) throw new HttpError(404, 'job_not_found');
  return row;
}

export function findJob(db: Db, id: string): Job {
  const found = db
    .select({ job: schema.jobs, projection: schema.jobProjections })
    .from(schema.jobs)
    .leftJoin(schema.jobProjections, eq(schema.jobs.id, schema.jobProjections.jobId))
    .where(eq(schema.jobs.id, id))
    .get();
  if (!found) throw new HttpError(404, 'job_not_found');
  return toJob(found.job, found.projection, openRequestCounts(db, [id]).get(id), queuePosition(db, found.job));
}

export function listJobs(db: Db, gameIds: string | readonly string[]): Job[] {
  const ids = typeof gameIds === 'string' ? [gameIds] : gameIds;
  if (ids.length === 0) return [];
  const rows = db
    .select({ job: schema.jobs, projection: schema.jobProjections })
    .from(schema.jobs)
    .leftJoin(schema.jobProjections, eq(schema.jobs.id, schema.jobProjections.jobId))
    .where(inArray(schema.jobs.gameId, ids))
    .orderBy(asc(schema.jobs.createdAt))
    .all();
  const requests = openRequestCounts(
    db,
    rows.map(({ job }) => job.id),
  );
  const at = new Date();
  return rows.map(({ job, projection }) => toJob(job, projection, requests.get(job.id), queuePosition(db, job, at)));
}

function openRequestCounts(db: Db, jobIds: readonly string[]): Map<string, number> {
  if (jobIds.length === 0) return new Map();
  const rows = db
    .select({ jobId: schema.commands.jobId, count: sql<number>`count(*)` })
    .from(schema.commands)
    .where(and(inArray(schema.commands.jobId, jobIds), eq(schema.commands.status, 'open')))
    .groupBy(schema.commands.jobId)
    .all();
  return new Map(rows.map(({ jobId, count }) => [jobId, Number(count)]));
}

export function acceptedFor(db: Db, row: JobRow, at = new Date()): CreateJobAccepted {
  const reservation = Reservation.parse(JSON.parse(row.reservation));
  if (row.state !== 'queued') return { jobId: row.id, state: 'admitted', reservation, slot: row.slot };
  return { jobId: row.id, state: row.state, reservation, slot: row.slot, position: queuePosition(db, row, at) };
}

function queuePosition(db: Db, row: JobRow, at = new Date()): number | undefined {
  if (row.state !== 'queued') return undefined;
  const now = at.toISOString();
  const ready = row.start === 'now' || (row.startAt !== null && row.startAt <= now);
  const position =
    db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.familyId, row.familyId),
          eq(schema.jobs.state, 'queued'),
          eq(schema.jobs.slot, row.slot),
          ready ? or(eq(schema.jobs.start, 'now'), lte(schema.jobs.startAt, now)) : eq(schema.jobs.start, 'at_reset'),
        ),
      )
      .orderBy(asc(schema.jobs.createdAt), sql`rowid`)
      .all()
      .findIndex(({ id }) => id === row.id) + 1;
  return Math.max(1, position);
}

// A daemon's ticket maps to a job through the job's game: the game's own daemon, or the registered daemon its
// repository shares (`daemonRowForGame`). Several games share one repo, and issue numbers are only unique inside one.
export function byTicket(db: Db, daemonSlug: string, ticket: string): { id: string; state: JobState } | null {
  const issueNumber = Number(ticket);
  if (!Number.isSafeInteger(issueNumber)) return null;
  const linked = db
    .select({ id: schema.jobs.id, state: schema.jobs.state, gameId: schema.jobs.gameId })
    .from(schema.jobTickets)
    .innerJoin(schema.jobs, eq(schema.jobTickets.jobId, schema.jobs.id))
    .where(and(eq(schema.jobTickets.issueNumber, issueNumber), isNotNull(schema.jobs.aiurIssueNumber)))
    .all()
    .find((job) => daemonRowForGame(db, job.gameId)?.slug === daemonSlug);
  if (linked) return { id: linked.id, state: linked.state };
  const found = db
    .select({ id: schema.jobs.id, state: schema.jobs.state, gameId: schema.jobs.gameId })
    .from(schema.jobs)
    .where(eq(schema.jobs.aiurIssueNumber, issueNumber))
    .all()
    .find((job) => daemonRowForGame(db, job.gameId)?.slug === daemonSlug);
  return found ? { id: found.id, state: found.state } : null;
}

const NON_TERMINAL_STATES: JobState[] = ['queued', 'admitted', 'filed', 'running', 'paused_budget'];

export function activeJobs(db: Db, daemonSlug: string): { jobId: string; ticket: string }[] {
  return db
    .select({ jobId: schema.jobs.id, gameId: schema.jobs.gameId, issueNumber: schema.jobs.aiurIssueNumber })
    .from(schema.jobs)
    .where(and(inArray(schema.jobs.state, NON_TERMINAL_STATES), jobHasOutstandingWork(db)))
    .orderBy(asc(schema.jobs.aiurIssueNumber), asc(schema.jobs.id))
    .all()
    .filter((row): row is { jobId: string; gameId: string; issueNumber: number } => row.issueNumber !== null)
    .filter((row) => daemonRowForGame(db, row.gameId)?.slug === daemonSlug)
    .flatMap(({ jobId, issueNumber }) => {
      const tickets = db
        .select({ issueNumber: schema.jobTickets.issueNumber })
        .from(schema.jobTickets)
        .where(eq(schema.jobTickets.jobId, jobId))
        .orderBy(asc(schema.jobTickets.issueNumber))
        .all();
      return (tickets.length === 0 ? [{ issueNumber }] : tickets).map((ticket) => ({
        jobId,
        ticket: String(ticket.issueNumber),
      }));
    });
}

// Jobs admitted and not finished for one game's daemon: the fleet sizes its concurrency from these.
export function activeJobsForSlug(db: Db, gameSlug: string): { kind: 'new_game' | 'feature' | 'repair' }[] {
  return db
    .select({ kind: schema.jobs.kind })
    .from(schema.jobs)
    .innerJoin(schema.games, eq(schema.jobs.gameId, schema.games.id))
    .where(
      and(
        eq(schema.games.slug, gameSlug.toLowerCase()),
        inArray(schema.jobs.state, SLOT_STATES),
        jobHasOutstandingWork(db),
      ),
    )
    .all()
    .map(({ kind }) => ({ kind: kind === 'scope' ? ('feature' as const) : kind }));
}
