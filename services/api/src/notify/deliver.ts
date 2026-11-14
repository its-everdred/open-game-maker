import type webpush from 'web-push';

import type { Notification, NotificationTrigger } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

import { render } from './render.js';
import {
  deleteSubscriptionById,
  insertNotification,
  recordSubscriptionFailure,
  recordSubscriptionSuccess,
  subscriptionsFor,
  type StoredPushSubscription,
} from './store.js';
import type { StreamHub } from './stream.js';

type PushClient = Pick<typeof webpush, 'sendNotification'>;

type DeliverDeps = {
  sqlite: Sqlite;
  stream: Pick<StreamHub, 'publish'>;
  push: PushClient;
  log?: (line: Record<string, unknown>) => void;
};

function triggerData(trigger: NotificationTrigger): Record<string, string | number> {
  switch (trigger.kind) {
    case 'build.done':
      return {
        gameId: trigger.gameId,
        jobId: trigger.jobId,
        buildId: trigger.buildId,
        ok: trigger.ok ? 1 : 0,
      };
    case 'job.started':
      return { gameId: trigger.gameId, jobId: trigger.jobId };
    case 'scope.agreed':
      return { gameId: trigger.gameId, jobId: trigger.jobId, sessionId: trigger.sessionId };
    case 'intake.report':
      return { dropId: trigger.dropId, status: trigger.status };
  }
}

function pushSubscription(subscription: StoredPushSubscription): webpush.PushSubscription {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  };
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

async function pushOne(
  deps: DeliverDeps,
  subscription: StoredPushSubscription,
  notification: Notification,
): Promise<void> {
  const payload = JSON.stringify({
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    ...(notification.url === undefined ? {} : { url: notification.url }),
  });

  try {
    await deps.push.sendNotification(pushSubscription(subscription), payload, {
      TTL: 3600,
      urgency: 'normal',
      timeout: 10_000,
    });
    recordSubscriptionSuccess(deps.sqlite, subscription.id);
  } catch (error) {
    const status = statusCode(error);
    deps.log?.({ event: 'push-failed', statusCode: status ?? null });
    if (status === 404 || status === 410) deleteSubscriptionById(deps.sqlite, subscription.id);
    else recordSubscriptionFailure(deps.sqlite, subscription.id);
  }
}

async function runWithConcurrency<T>(items: readonly T[], concurrency: number, run: (item: T) => Promise<void>) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export async function deliver(deps: DeliverDeps, trigger: NotificationTrigger): Promise<{ delivered: number }> {
  const rendered = render(trigger, {});
  const pushes: { subscription: StoredPushSubscription; notification: Notification }[] = [];
  const recipients = [...new Set(trigger.userIds)];

  for (const userId of recipients) {
    const notification = insertNotification(deps.sqlite, {
      userId,
      kind: trigger.kind,
      ...rendered,
      data: triggerData(trigger),
    });
    deps.stream.publish(userId, notification);
    for (const subscription of subscriptionsFor(deps.sqlite, userId)) pushes.push({ subscription, notification });
  }

  await runWithConcurrency(pushes, 8, ({ subscription, notification }) => pushOne(deps, subscription, notification));
  return { delivered: recipients.length };
}

// Deliver an already-persisted item without inserting a duplicate inbox row.
export async function deliverStored(deps: DeliverDeps, notification: Notification): Promise<void> {
  deps.stream.publish(notification.userId, notification);
  await runWithConcurrency(subscriptionsFor(deps.sqlite, notification.userId), 8, (subscription) =>
    pushOne(deps, subscription, notification),
  );
}
