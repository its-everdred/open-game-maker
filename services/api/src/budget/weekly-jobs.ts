import { schema, type Db } from '@ogm/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { weekWindow } from './week.js';

export type WeeklyLimits = { newGames: number | null; edits: number | null };
export const DEFAULT_WEEKLY_LIMITS: WeeklyLimits = { newGames: 2, edits: 20 };

export function weeklyLimits(db: Db, email: string, role?: string): WeeklyLimits {
  const row = db.select().from(schema.weeklyJobBudgets).where(eq(schema.weeklyJobBudgets.email, email)).get();
  if (row) return { newGames: row.newGames, edits: row.edits };
  return role === 'admin' ? { newGames: null, edits: null } : DEFAULT_WEEKLY_LIMITS;
}

export function weeklyJobs(db: Db, userId: string, now: Date, zone: string) {
  const window = weekWindow(now, zone);
  const user = db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId)).get();
  const address = user?.email.toLowerCase() ?? '';
  const allowed = db.select().from(schema.allowedUsers).where(eq(schema.allowedUsers.email, address)).get();
  const limits = weeklyLimits(db, address, allowed?.role);
  const rows = db
    .select({ kind: schema.jobs.kind, count: sql<number>`count(*)` })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.creatorId, userId),
        sql`substr(coalesce(${schema.jobs.idempotencyKey}, ''), 1, 8) != 'planner:'`,
        gte(sql<string>`coalesce(${schema.jobs.startAt}, ${schema.jobs.createdAt})`, window.startsAt),
        lt(sql<string>`coalesce(${schema.jobs.startAt}, ${schema.jobs.createdAt})`, window.resetsAt),
      ),
    )
    .groupBy(schema.jobs.kind)
    .all();
  const count = (kind: string) => rows.find((row) => row.kind === kind)?.count ?? 0;
  const remaining = (limit: number | null, used: number) => (limit === null ? null : Math.max(0, limit - used));
  return {
    limits,
    remaining: {
      newGames: remaining(limits.newGames, count('new_game')),
      edits: remaining(limits.edits, count('feature') + count('repair')),
    },
    ...window,
  };
}
