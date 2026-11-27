import { schema, type Db } from '@ogm/db';
import { and, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';

import { SLOT_STATES } from './state.js';

// A budget release does not prove every ticket in a job has stopped.
export function jobHasOutstandingWork(db: Db) {
  return or(
    isNull(schema.jobs.releasedAt),
    exists(
      db
        .select({ key: schema.jobTickets.key })
        .from(schema.jobTickets)
        .where(and(eq(schema.jobTickets.jobId, schema.jobs.id), isNull(schema.jobTickets.terminalState))),
    ),
  );
}

// Called inside the admission transaction, so concurrent requests cannot both claim a creator's slot.
export function creatorHoldsSlot(db: Db, creatorId: string, limit: number): boolean {
  if (limit === 0) return false;
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.jobs)
      .where(
        and(eq(schema.jobs.creatorId, creatorId), inArray(schema.jobs.state, SLOT_STATES), jobHasOutstandingWork(db)),
      )
      .get()!.count >= limit
  );
}
