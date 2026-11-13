import { schema, type Db } from '@ogm/db';
import { and, desc, eq, like } from 'drizzle-orm';

// The feed is scoped by game daemon. Only tracker-confirmed completions are terminal; a pause or a
// later restart must never be presented as a finished build.
export function recentCompletions(db: Db, daemonSlug: string) {
  const rows = db
    .select()
    .from(schema.aiurEvents)
    .where(
      and(eq(schema.aiurEvents.daemonSlug, daemonSlug), like(schema.aiurEvents.topic, 'ticket.%.lifecycle.changed')),
    )
    .orderBy(desc(schema.aiurEvents.seq))
    .limit(500)
    .all();
  const seen = new Set<string>();
  const completed: Array<{ ticket: string; seq: number; at: string }> = [];
  for (const row of rows) {
    if (!row.ticket || seen.has(row.ticket)) continue;
    seen.add(row.ticket);
    try {
      const payload: unknown = JSON.parse(row.payload);
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'lifecycle' in payload &&
        payload.lifecycle === 'completed' &&
        'lifecycle_source' in payload &&
        payload.lifecycle_source === 'tracker'
      ) {
        completed.push({ ticket: row.ticket, seq: row.seq, at: row.observedAt });
      }
    } catch {
      // A malformed stored event cannot establish completion.
    }
  }
  return { cursor: rows[0]?.seq ?? 0, completed };
}
