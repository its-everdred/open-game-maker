import { eq, isNull } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { Notification as NotificationSchema, type Notification } from '@ogm/contracts';
import type { AppDeps } from '../app/types.js';
import { listGameCommandRefs } from '../commands/list.js';
import type { GameRow } from '../games/games.js';
import { insertNotification } from '../notify/store.js';
import { latestPublishedPrototypeRound, latestRoundForTicket } from './store.js';
import { REVIEW_NOTIFICATION_COOLDOWN_MS } from './notification-cooldown.js';

type Candidate = { userId: string; key: string; ticketKey: string };
type CommandRef = { decision_id: string; version: number; ticket?: string | null };

// Persist the item keys with the notification so a restart cannot notify the same open items again.
export function queueReadyNotifications(deps: AppDeps, candidates: readonly Candidate[], now: Date): Notification[] {
  return deps.db.transaction(() => {
    const rows = deps.sqlite
      .prepare(
        "SELECT user_id AS userId, data_json AS dataJson, created_at AS createdAt FROM notifications WHERE kind = 'review.ready'",
      )
      .all() as { userId: string; dataJson: string | null; createdAt: string }[];
    const seenItems = new Set<string>();
    const lastNotified = new Map<string, number>();
    for (const row of rows) {
      try {
        const data = JSON.parse(row.dataJson ?? '{}') as { keys?: unknown; ticketKeys?: unknown };
        const keys: unknown = typeof data.keys === 'string' ? JSON.parse(data.keys) : [];
        if (Array.isArray(keys))
          for (const key of keys) if (typeof key === 'string') seenItems.add(`${row.userId}\0${key}`);
        const ticketKeys: unknown = typeof data.ticketKeys === 'string' ? JSON.parse(data.ticketKeys) : [];
        const timestamp = Date.parse(row.createdAt);
        if (Array.isArray(ticketKeys) && Number.isFinite(timestamp))
          for (const ticketKey of ticketKeys)
            if (typeof ticketKey === 'string') {
              const key = `${row.userId}\0${ticketKey}`;
              lastNotified.set(key, Math.max(lastNotified.get(key) ?? 0, timestamp));
            }
      } catch {
        // Ignore malformed historical notification data; it cannot attest that an item was delivered.
      }
    }
    const batches = new Map<string, { keys: string[]; ticketKeys: Set<string> }>();
    for (const candidate of candidates) {
      const itemKey = `${candidate.userId}\0${candidate.key}`;
      if (seenItems.has(itemKey)) continue;
      seenItems.add(itemKey);
      const ticketKey = `${candidate.userId}\0${candidate.ticketKey}`;
      const previous = lastNotified.get(ticketKey) ?? 0;
      if (now.getTime() - previous < REVIEW_NOTIFICATION_COOLDOWN_MS) continue;
      const batch = batches.get(candidate.userId) ?? { keys: [], ticketKeys: new Set<string>() };
      batch.keys.push(candidate.key);
      batch.ticketKeys.add(candidate.ticketKey);
      batches.set(candidate.userId, batch);
    }
    return [...batches].map(([userId, batch]) =>
      insertNotification(
        deps.sqlite,
        {
          userId,
          kind: 'review.ready',
          title: 'Reviews are ready',
          body: 'New items are waiting for your review.',
          url: '/all',
          data: {
            keys: JSON.stringify(batch.keys),
            ticketKeys: JSON.stringify([...batch.ticketKeys]),
            deliveryPending: 1,
          },
        },
        { now },
      ),
    );
  });
}

function pendingNotifications(deps: AppDeps): { notification: Notification; data: Record<string, string | number> }[] {
  return deps.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.kind, 'review.ready'))
    .all()
    .flatMap((row) => {
      try {
        const data = JSON.parse(row.dataJson ?? '{}') as Record<string, string | number>;
        if (data.deliveryPending !== 1) return [];
        const parsed = NotificationSchema.safeParse({
          id: row.id,
          userId: row.userId,
          kind: row.kind,
          title: row.title,
          body: row.body,
          ...(row.url === null ? {} : { url: row.url }),
          data,
          createdAt: row.createdAt,
          readAt: row.readAt,
        });
        return parsed.success ? [{ notification: parsed.data, data }] : [];
      } catch {
        return [];
      }
    });
}

export function createReadyReviewNotifier(
  deps: AppDeps,
  options: {
    commands?: (game: GameRow) => Promise<readonly CommandRef[]>;
    deliver(notification: Notification): Promise<void>;
    now?: () => Date;
  },
) {
  let running = false;
  const commands = options.commands ?? ((game: GameRow) => listGameCommandRefs(deps, game));
  return async () => {
    if (running) return;
    running = true;
    try {
      const games = deps.db.select().from(schema.games).all();
      const commandsByGame = new Map<string, readonly CommandRef[]>();
      for (const game of games) {
        if (!game.ownerId) continue;
        try {
          commandsByGame.set(game.id, await commands(game));
        } catch (error) {
          deps.log({ event: 'review_ready_scan_error', gameId: game.id, error: (error as Error).name });
        }
      }
      const candidates: Candidate[] = [];
      const rounds = deps.db.select().from(schema.reviewRounds).where(isNull(schema.reviewRounds.verdict)).all();
      for (const game of deps.db.select().from(schema.games).all()) {
        if (!game.ownerId) continue;
        for (const round of rounds) {
          if (
            round.gameId === game.id &&
            (round.track === 'prototype-publish'
              ? latestPublishedPrototypeRound(deps.db, game.id)?.id === round.id
              : latestRoundForTicket(deps.db, game.id, round.ticket)?.id === round.id)
          )
            candidates.push({
              userId: game.ownerId,
              key: `round:${game.id}:${round.id}`,
              ticketKey: `${game.id}:${round.ticket}`,
            });
        }
        for (const command of commandsByGame.get(game.id) ?? [])
          candidates.push({
            userId: game.ownerId,
            key: `command:${game.id}:${command.decision_id}:${command.version}`,
            ticketKey: `${game.id}:${command.ticket ?? `command:${command.decision_id}`}`,
          });
      }
      queueReadyNotifications(deps, candidates, options.now?.() ?? new Date());
      for (const { notification, data } of pendingNotifications(deps)) {
        try {
          await options.deliver(notification);
          deps.db
            .update(schema.notifications)
            .set({ dataJson: JSON.stringify({ ...data, deliveryPending: 0 }) })
            .where(eq(schema.notifications.id, notification.id))
            .run();
        } catch (error) {
          deps.log({ event: 'review_ready_delivery_error', error: (error as Error).name });
        }
      }
    } finally {
      running = false;
    }
  };
}

export function startReadyReviewNotifier(notify: () => Promise<void>, intervalMs: number, log: AppDeps['log']) {
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (pending) return;
    pending = Promise.resolve()
      .then(notify)
      .catch((error: unknown) => {
        log({ event: 'review_ready_scan_error', error: (error as Error).name });
      })
      .finally(() => {
        pending = undefined;
      });
  }, intervalMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
    idle: async () => {
      await pending;
    },
  };
}
