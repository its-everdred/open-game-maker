import { schema, type Db } from '@ogm/db';
import { eq, inArray } from 'drizzle-orm';

import { activeJobs, byTicket } from './repo.js';
import { applyTerminalSnapshot, type ProjectionDeps } from './projection.js';

// Reset sequence fences when Aiur starts a new feed epoch; terminal facts remain durable.
export function resetTicketSequences(db: Db, daemonSlug: string): void {
  const ids = [...new Set(activeJobs(db, daemonSlug).map((job) => job.jobId))];
  if (ids.length) {
    db.update(schema.jobTickets).set({ lifecycleSeq: null }).where(inArray(schema.jobTickets.jobId, ids)).run();
    db.update(schema.jobProjections).set({ lastEventSeq: null }).where(inArray(schema.jobProjections.jobId, ids)).run();
  }
}

export function createTicketRecovery(
  deps: ProjectionDeps,
  labels: (repo: string, issueNumber: number) => Promise<string[]>,
) {
  return async (daemonSlug: string, ticket: string): Promise<void> => {
    const job = byTicket(deps.db, daemonSlug, ticket);
    if (!job) return;
    const row = deps.db
      .select({ repo: schema.jobs.aiurRepo })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, job.id))
      .get();
    if (!row?.repo) return;
    const cursor = () =>
      deps.db.select().from(schema.aiurCursors).where(eq(schema.aiurCursors.daemonSlug, daemonSlug)).get();
    const before = cursor();
    const current = await labels(row.repo, Number(ticket));
    const after = cursor();
    if (before?.lastSeq !== after?.lastSeq || before?.epoch !== after?.epoch) return;
    const prefix = [daemonSlug.toLowerCase(), 'agent'];
    const states = current
      .map((label) => label.toLowerCase())
      .flatMap((label) =>
        prefix.flatMap((name) => (label.startsWith(`${name}:`) ? [label.slice(name.length + 1)] : [])),
      )
      .filter((state) =>
        [
          'todo',
          'in-progress',
          'ci-wait',
          'human-review',
          'rework',
          'merging',
          'done',
          'cancelled',
          'canceled',
          'error',
        ].includes(state),
      );
    if (states.length !== 1) return;
    if (states[0] === 'done') applyTerminalSnapshot(deps, daemonSlug, ticket, 'done', before?.lastSeq);
    else if (states[0] === 'cancelled' || states[0] === 'canceled')
      applyTerminalSnapshot(deps, daemonSlug, ticket, 'cancelled', before?.lastSeq);
  };
}
