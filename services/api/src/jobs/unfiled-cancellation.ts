import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { findJobRow, type JobRow } from './repo.js';

// Serialize the ticket checkpoint and cancellation. Once any ticket is recorded,
// intake may already be making it runnable, so cancellation must retry after filing.
export function cancelBeforeFiling<T>(deps: AppDeps, jobId: string, cancel: (job: JobRow) => T): T {
  return deps.sqlite
    .transaction(() => {
      const job = findJobRow(deps.db, jobId);
      if (!['queued', 'admitted'].includes(job.state) || job.aiurRepo !== null || job.aiurIssueNumber !== null)
        throw new HttpError(409, 'job_filing');
      const ticket = deps.db
        .select({ key: schema.jobTickets.key })
        .from(schema.jobTickets)
        .where(eq(schema.jobTickets.jobId, jobId))
        .get();
      if (ticket) throw new HttpError(409, 'job_filing');
      return cancel(job);
    })
    .immediate();
}
