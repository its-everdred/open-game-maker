import { schema, type Db } from '@ogm/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { SLOT_STATES } from './state.js';

// Called inside the admission transaction, so concurrent requests cannot both claim a creator's slot.
export function creatorHoldsSlot(db: Db, creatorId: string, limit: number): boolean {
  if (limit === 0) return false;
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.creatorId, creatorId),
          inArray(schema.jobs.state, SLOT_STATES),
          isNull(schema.jobs.releasedAt),
        ),
      )
      .get()!.count >= limit
  );
}
