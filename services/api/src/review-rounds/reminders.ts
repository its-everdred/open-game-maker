import { eq } from 'drizzle-orm';
import type { Notification } from '@ogm/contracts';
import { schema, type Db, type Sqlite } from '@ogm/db';
import { insertNotification } from '../notify/store.js';
import { markReminded } from './store.js';
import { reviewStalls } from './stalls.js';

// Commit the reminder and its acknowledgement together, so retries cannot create a second inbox item.
export function queueReviewReminders(db: Db, sqlite: Sqlite, now: number): Notification[] {
  const notifications: Notification[] = [];
  for (const round of reviewStalls(db, now).creator) {
    const game = db.select().from(schema.games).where(eq(schema.games.id, round.gameId)).get();
    if (!game?.ownerId || !game.slug) continue;
    const notification = db.transaction((tx) => {
      if (!markReminded(tx, round.id, new Date(now).toISOString())) return null;
      return insertNotification(
        sqlite,
        {
          userId: game.ownerId,
          kind: 'review.reminder',
          title: 'A review is waiting',
          body: game.title,
          url: `/${encodeURIComponent(game.slug!)}/review`,
          data: { gameId: game.id, roundId: round.id },
        },
        { now: new Date(now) },
      );
    });
    if (notification) notifications.push(notification);
  }
  return notifications;
}
