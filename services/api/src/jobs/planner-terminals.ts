import { withJobDispatchLock } from '@ogm/builder';
import { schema, type Db } from '@ogm/db';
import { and, eq, inArray } from 'drizzle-orm';

type Terminal = 'done' | 'failed' | 'cancelled';

/** Serialize planner terminal events with the release of its children, and replay durable projections on restart. */
export function createPlannerTerminals(
  db: Db,
  finish: (jobId: string, state: Terminal) => void,
  log: (error: unknown) => void,
) {
  function apply(jobId: string, state: Terminal): Promise<void> {
    const job = db.select({ kind: schema.jobs.kind }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
    if (job?.kind !== 'new_game') {
      finish(jobId, state);
      return Promise.resolve();
    }
    return withJobDispatchLock(jobId, async () => {
      const current = db.select({ state: schema.jobs.state }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
      if (current && !['done', 'failed', 'cancelled'].includes(current.state)) finish(jobId, state);
    }).catch(log);
  }
  async function reconcile(): Promise<void> {
    const rows = db
      .select({ id: schema.jobs.id, lifecycle: schema.jobProjections.lifecycle })
      .from(schema.jobs)
      .innerJoin(schema.jobProjections, eq(schema.jobProjections.jobId, schema.jobs.id))
      .where(
        and(
          eq(schema.jobs.kind, 'new_game'),
          inArray(schema.jobs.state, ['filed', 'running', 'paused_budget']),
          inArray(schema.jobProjections.lifecycle, ['completed', 'cancelled']),
        ),
      )
      .all();
    for (const row of rows) await apply(row.id, row.lifecycle === 'cancelled' ? 'cancelled' : 'done');
  }
  function start(): () => void {
    void reconcile().catch(log);
    const timer = setInterval(() => void reconcile().catch(log), 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }
  return { apply, reconcile, start };
}
