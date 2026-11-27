import { schema } from '@ogm/db';
import { and, eq, isNotNull, or } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { findJobRow, type JobRow } from './repo.js';

// Serialize cancellation with intake's spend-cap checkpoint. A worker ticket cannot
// become runnable before that checkpoint; a New Game parent has its own handoff.
export function cancelBeforeFiling<T>(deps: AppDeps, jobId: string, cancel: (job: JobRow) => T): T {
  return deps.sqlite
    .transaction(() => {
      const job = findJobRow(deps.db, jobId);
      if (!['queued', 'admitted'].includes(job.state) || job.aiurRepo !== null || job.aiurIssueNumber !== null)
        throw new HttpError(409, 'job_filing');
      if (job.kind === 'new_game' && job.state === 'admitted') throw new HttpError(409, 'job_filing');
      const ticket = deps.db
        .select({ key: schema.jobTickets.key })
        .from(schema.jobTickets)
        .where(
          and(
            eq(schema.jobTickets.jobId, jobId),
            job.kind === 'new_game'
              ? undefined
              : or(
                  isNotNull(schema.jobTickets.capSetAt),
                  isNotNull(schema.jobTickets.todoAt),
                  isNotNull(schema.jobTickets.filedAt),
                ),
          ),
        )
        .get();
      if (ticket) throw new HttpError(409, 'job_filing');
      return cancel(job);
    })
    .immediate();
}
