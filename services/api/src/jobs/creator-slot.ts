import { schema, type Db } from '@ogm/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { SLOT_STATES } from './state.js';

// Called inside the admission transaction, so concurrent requests cannot both claim a creator's slot.
export function creatorHoldsSlot(db: Db, creatorId: string): boolean {
  return Boolean(
    db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.creatorId, creatorId),
          inArray(schema.jobs.state, SLOT_STATES),
          isNull(schema.jobs.releasedAt),
        ),
      )
      .get(),
  );
}
