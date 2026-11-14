import { randomUUID } from 'node:crypto';

import {
  Notification as NotificationSchema,
  type Notification,
  type NotificationKind,
  type PushSubscriptionInput,
} from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

export type StoredPushSubscription = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  createdAt: string;
  lastOkAt: string | null;
  failures: number;
};

type NotificationRow = {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  dataJson: string | null;
  createdAt: string;
  readAt: string | null;
};

type NewNotification = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string | number>;
  readAt?: string | null;
};

const notificationColumns = `
  id,
  user_id AS userId,
  kind,
  title,
  body,
  url,
  data_json AS dataJson,
  created_at AS createdAt,
  read_at AS readAt
`;

const subscriptionColumns = `
  id,
  user_id AS userId,
  endpoint,
  p256dh,
  auth,
  expiration_time AS expirationTime,
  created_at AS createdAt,
  last_ok_at AS lastOkAt,
  failures
`;

function toNotification(row: NotificationRow): Notification {
  return NotificationSchema.parse({
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    ...(row.url === null ? {} : { url: row.url }),
    ...(row.dataJson === null ? {} : { data: JSON.parse(row.dataJson) as unknown }),
    createdAt: row.createdAt,
    readAt: row.readAt,
  });
}

export function insertNotification(
  sqlite: Sqlite,
  input: NewNotification,
  options: { id?: string; now?: Date } = {},
): Notification {
  const row: NotificationRow = {
    id: options.id ?? `n_${randomUUID()}`,
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    url: input.url ?? null,
    dataJson: input.data === undefined ? null : JSON.stringify(input.data),
    createdAt: (options.now ?? new Date()).toISOString(),
    readAt: input.readAt ?? null,
  };
  sqlite
    .prepare(
      `INSERT INTO notifications
       (id, user_id, kind, title, body, url, data_json, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.userId, row.kind, row.title, row.body, row.url, row.dataJson, row.createdAt, row.readAt);
  return toNotification(row);
}

export function listNotifications(
  sqlite: Sqlite,
  userId: string,
  options: { unread?: boolean; limit?: number; kind?: NotificationKind },
): Notification[] {
  const unread = options.unread ? 'AND read_at IS NULL' : '';
  const kind = options.kind ? 'AND kind = ?' : '';
  return (
    sqlite
      .prepare(
        `SELECT ${notificationColumns}
         FROM notifications
         WHERE user_id = ? ${unread} ${kind}
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(
        ...(options.kind ? [userId, options.kind, options.limit ?? 50] : [userId, options.limit ?? 50]),
      ) as NotificationRow[]
  ).map(toNotification);
}

export function replayNotifications(sqlite: Sqlite, userId: string, lastId: string, limit = 100): Notification[] {
  const anchor = sqlite
    .prepare('SELECT created_at AS createdAt, rowid AS rowId FROM notifications WHERE id = ? AND user_id = ?')
    .get(lastId, userId) as { createdAt: string; rowId: number } | undefined;
  if (!anchor) return [];

  return (
    sqlite
      .prepare(
        `SELECT ${notificationColumns}
         FROM notifications
         WHERE user_id = ?
           AND (created_at > ? OR (created_at = ? AND rowid > ?))
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?`,
      )
      .all(userId, anchor.createdAt, anchor.createdAt, anchor.rowId, limit) as NotificationRow[]
  ).map(toNotification);
}

export function markRead(sqlite: Sqlite, userId: string, id: string, now = new Date()): boolean {
  return (
    sqlite
      .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?')
      .run(now.toISOString(), id, userId).changes > 0
  );
}

export function upsertSubscription(
  sqlite: Sqlite,
  userId: string,
  input: PushSubscriptionInput,
  now = new Date(),
): StoredPushSubscription {
  sqlite
    .prepare(
      `INSERT INTO push_subscriptions
       (id, user_id, endpoint, p256dh, auth, expiration_time, created_at, failures)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         expiration_time = excluded.expiration_time,
         failures = 0`,
    )
    .run(
      `ps_${randomUUID()}`,
      userId,
      input.endpoint,
      input.keys.p256dh,
      input.keys.auth,
      input.expirationTime ?? null,
      now.toISOString(),
    );

  return sqlite
    .prepare(`SELECT ${subscriptionColumns} FROM push_subscriptions WHERE endpoint = ?`)
    .get(input.endpoint) as StoredPushSubscription;
}

export function deleteSubscription(sqlite: Sqlite, userId: string, endpoint: string): boolean {
  return (
    sqlite.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint).changes >
    0
  );
}

export function deleteSubscriptionById(sqlite: Sqlite, id: string): void {
  sqlite.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
}

export function subscriptionsFor(sqlite: Sqlite, userId: string): StoredPushSubscription[] {
  return sqlite
    .prepare(`SELECT ${subscriptionColumns} FROM push_subscriptions WHERE user_id = ? ORDER BY created_at ASC`)
    .all(userId) as StoredPushSubscription[];
}

export function recordSubscriptionSuccess(sqlite: Sqlite, id: string, now = new Date()): void {
  sqlite.prepare('UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE id = ?').run(now.toISOString(), id);
}

export function recordSubscriptionFailure(sqlite: Sqlite, id: string): number | null {
  const subscription = sqlite.prepare('SELECT failures FROM push_subscriptions WHERE id = ?').get(id) as
    { failures: number } | undefined;
  if (!subscription) return null;

  const failures = subscription.failures + 1;
  if (failures >= 5) deleteSubscriptionById(sqlite, id);
  else sqlite.prepare('UPDATE push_subscriptions SET failures = ? WHERE id = ?').run(failures, id);
  return failures;
}
