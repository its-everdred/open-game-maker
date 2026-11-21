import { and, eq, gte, inArray } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';

export const REVIEW_NOTIFICATION_COOLDOWN_MS = 10 * 60_000;

export function hasRecentReviewNotification(db: Db, userId: string, ticketKey: string, now: Date): boolean {
  const cutoff = new Date(now.getTime() - REVIEW_NOTIFICATION_COOLDOWN_MS).toISOString();
  const notices = db
    .select({ kind: schema.notifications.kind, dataJson: schema.notifications.dataJson })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        gte(schema.notifications.createdAt, cutoff),
        inArray(schema.notifications.kind, ['review.ready', 'executor.notify']),
      ),
    )
    .all();
  for (const notice of notices) {
    try {
      const data = JSON.parse(notice.dataJson ?? '{}') as { ticketKeys?: unknown; reviewTicketKey?: unknown };
      if (notice.kind === 'executor.notify' && data.reviewTicketKey === ticketKey) return true;
      const keys: unknown = typeof data.ticketKeys === 'string' ? JSON.parse(data.ticketKeys) : [];
      if (notice.kind === 'review.ready' && Array.isArray(keys) && keys.includes(ticketKey)) return true;
    } catch {
      // Malformed historical notifications cannot attest that this ticket was recently notified.
    }
  }
  return false;
}
