import { schema, type Db } from '@ogm/db';
import { and, eq, isNull, lte, or } from 'drizzle-orm';

export type TicketTerminal = 'done' | 'cancelled';
export type TicketAggregate = TicketTerminal | 'waiting' | 'stale' | 'legacy';

function aggregateTickets(db: Db, jobId: string): TicketAggregate {
  const all = db
    .select({ terminalState: schema.jobTickets.terminalState })
    .from(schema.jobTickets)
    .where(eq(schema.jobTickets.jobId, jobId))
    .all();
  if (all.length === 0) return 'legacy';
  if (all.some((row) => row.terminalState === null)) return 'waiting';
  return all.some((row) => row.terminalState === 'cancelled') ? 'cancelled' : 'done';
}

export function recordedTicketAggregate(db: Db, jobId: string): TicketAggregate {
  return aggregateTickets(db, jobId);
}

// A verified tracker snapshot can recover a terminal event lost from the feed.
export function recordTerminalSnapshot(
  db: Db,
  jobId: string,
  ticket: number,
  state: TicketTerminal,
  fence?: number,
): TicketAggregate {
  const current = db
    .select({ lifecycleSeq: schema.jobTickets.lifecycleSeq })
    .from(schema.jobTickets)
    .where(and(eq(schema.jobTickets.jobId, jobId), eq(schema.jobTickets.issueNumber, ticket)))
    .get();
  if (!current) return 'legacy';
  const lifecycleSeq = fence === undefined ? current.lifecycleSeq : Math.max(current.lifecycleSeq ?? 0, fence);
  const changed = db
    .update(schema.jobTickets)
    .set({ terminalState: state, lifecycleSeq })
    .where(and(eq(schema.jobTickets.jobId, jobId), eq(schema.jobTickets.issueNumber, ticket)))
    .run();
  return changed.changes === 0 ? 'legacy' : aggregateTickets(db, jobId);
}

// Persist each ticket separately: one completed worker does not finish a multi-ticket job.
export function recordTicketLifecycle(
  db: Db,
  jobId: string,
  ticket: number,
  seq: number,
  lifecycle: string,
): TicketAggregate {
  const rows = db.select().from(schema.jobTickets).where(eq(schema.jobTickets.jobId, jobId)).all();
  if (rows.length === 0) return 'legacy';
  const current = rows.find((row) => row.issueNumber === ticket);
  if (!current) return 'stale';
  const terminalState = lifecycle === 'completed' ? 'done' : lifecycle === 'cancelled' ? 'cancelled' : null;
  const updated = db
    .update(schema.jobTickets)
    .set({ terminalState, lifecycleSeq: seq })
    .where(
      and(
        eq(schema.jobTickets.jobId, jobId),
        eq(schema.jobTickets.issueNumber, ticket),
        or(isNull(schema.jobTickets.lifecycleSeq), lte(schema.jobTickets.lifecycleSeq, seq)),
      ),
    )
    .run();
  if (updated.changes === 0) return 'stale';
  return aggregateTickets(db, jobId);
}
