import { schema, type Db } from '@ogm/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { dayKey, nextReset } from '../budget/reset.js';

/** Count distinct games created or scheduled by this creator on the target local day. */
export function newGameDailyUsage(db: Db, userId: string, at: Date, zone: string) {
  const reset = nextReset(at, zone);
  // Civil days can be 25 hours at a daylight-saving transition; filter a wider interval by local date.
  const earliest = new Date(reset.getTime() - 27 * 60 * 60 * 1000).toISOString();
  const end = reset.toISOString();
  const effectiveStart = sql<string>`coalesce(${schema.jobs.startAt}, ${schema.jobs.createdAt})`;
  const jobs = db
    .select({ id: schema.jobs.gameId, at: effectiveStart })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.creatorId, userId),
        eq(schema.jobs.kind, 'new_game'),
        gte(effectiveStart, earliest),
        lt(effectiveStart, end),
      ),
    )
    .all();
  const games = db
    .select({ id: schema.games.id, at: schema.games.createdAt })
    .from(schema.games)
    .where(
      and(eq(schema.games.ownerId, userId), gte(schema.games.createdAt, earliest), lt(schema.games.createdAt, end)),
    )
    .all();
  const day = dayKey(at, zone);
  const gameIds = [
    ...new Set([...games, ...jobs].filter((row) => dayKey(new Date(row.at), zone) === day).map((row) => row.id)),
  ];
  return { count: gameIds.length, gameIds, resetsAt: end };
}
