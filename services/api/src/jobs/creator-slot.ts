import { schema, type Db } from '@ogm/db';
import { and, eq, exists, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import { SLOT_STATES } from './state.js';

// A budget release does not prove every ticket in a job has stopped.
export function hasUnfinishedTickets(db: Db) {
  // New Game parent issues are handed to the Executor and do not run a worker.
  return and(
    ne(schema.jobs.kind, 'new_game'),
    exists(
      db
        .select({ key: schema.jobTickets.key })
        .from(schema.jobTickets)
        .where(and(eq(schema.jobTickets.jobId, schema.jobs.id), isNull(schema.jobTickets.terminalState))),
    ),
  );
}

export function jobHasOutstandingWork(db: Db) {
  return or(and(inArray(schema.jobs.state, SLOT_STATES), isNull(schema.jobs.releasedAt)), hasUnfinishedTickets(db));
}

// Called inside the admission transaction, so concurrent requests cannot both claim a creator's slot.
export function creatorHoldsSlot(db: Db, creatorId: string, limit: number, excludeJobId?: string): boolean {
  if (limit === 0) return false;
  const creatorJobs = excludeJobId
    ? and(eq(schema.jobs.creatorId, creatorId), ne(schema.jobs.id, excludeJobId), jobHasOutstandingWork(db))
    : and(eq(schema.jobs.creatorId, creatorId), jobHasOutstandingWork(db));
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.jobs)
      .where(creatorJobs)
      .get()!.count >= limit
  );
}
