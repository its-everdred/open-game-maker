import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import webpush from 'web-push';
import { z } from 'zod';

import { NotificationKind, NotificationTrigger, PushSubscriptionInput, type Notification } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { deliver, deliverStored } from './deliver.js';
import { deleteSubscription, listNotifications, markRead, replayNotifications, upsertSubscription } from './store.js';
import { createStreamHub, formatSseFrame, type SSEWriter, type StreamHub } from './stream.js';
import { loadOrCreateVapid } from './vapid.js';

export const prefix = '/';

type NotifyRuntime = {
  publicKey: string;
  stream: StreamHub;
  deliver: (trigger: z.output<typeof NotificationTrigger>) => Promise<{ delivered: number }>;
  deliverStored: (notification: Notification) => Promise<void>;
};

const runtimes = new WeakMap<AppDeps, NotifyRuntime>();
const subscriptionEndpoint = z.object({ endpoint: z.string().url() });
const notificationQuery = z.object({
  unread: z.literal('1').optional(),
  kind: NotificationKind.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function getNotifyRuntime(deps: AppDeps): NotifyRuntime {
  const runtime = runtimes.get(deps);
  if (!runtime) throw new Error('notification context was not set up');
  return runtime;
}

export function setup(deps: AppDeps): void {
  if (runtimes.has(deps)) return;
  const vapid = loadOrCreateVapid(deps.config.vapidKeyFile, deps.config.vapidSubject, { log: deps.log });
  const stream = createStreamHub();
  const deliverTrigger = (trigger: z.output<typeof NotificationTrigger>) =>
    deliver({ sqlite: deps.sqlite, stream, push: webpush, log: deps.log }, trigger);
  runtimes.set(deps, {
    publicKey: vapid.publicKey,
    stream,
    deliver: deliverTrigger,
    deliverStored: (notification) =>
      deliverStored({ sqlite: deps.sqlite, stream, push: webpush, log: deps.log }, notification),
  });
  deps.events.on('notify', (trigger) => {
    void deliverTrigger(trigger).catch((error: unknown) => {
      deps.log({ event: 'notification-delivery-error', stack: error instanceof Error ? error.stack : String(error) });
    });
  });
}

function userId(c: Parameters<typeof requirePrincipal>[0]): string {
  return requirePrincipal(c, ['user']).userId;
}

function notificationStream(c: Parameters<typeof streamSSE>[0], deps: AppDeps, id: string) {
  const runtime = getNotifyRuntime(deps);
  if (!runtime.stream.canAttach(id)) throw new HttpError(503, 'too_many_streams');
  const lastId = c.req.header('last-event-id');
  const replay = lastId ? replayNotifications(deps.sqlite, id, lastId) : [];

  return streamSSE(c, async (stream) => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let queue = Promise.resolve();
    const writer: SSEWriter = {
      write(frame) {
        queue = queue.then(async () => {
          await stream.write(frame);
        });
        return queue;
      },
      async close() {
        finish();
        await stream.close();
      },
    };

    for (const notification of replay) void writer.write(formatSseFrame(notification));
    const detach = runtime.stream.attach(id, writer);
    stream.onAbort(finish);
    const keepalive = setInterval(() => {
      void writer.write(': ping\n\n').catch(finish);
    }, 25_000);
    keepalive.unref();

    try {
      await queue;
      await finished;
    } finally {
      clearInterval(keepalive);
      detach();
    }
  });
}

export default new Hono<ApiBindings>()
  .get('/api/v1/push/vapid-public-key', (c) => c.json({ publicKey: getNotifyRuntime(c.get('deps')).publicKey }))
  .post('/api/v1/push/subscriptions', async (c) => {
    const subscription = await parseBody(c, PushSubscriptionInput);
    return c.json(upsertSubscription(c.get('deps').sqlite, userId(c), subscription), 201);
  })
  .delete('/api/v1/push/subscriptions', async (c) => {
    const { endpoint } = await parseBody(c, subscriptionEndpoint);
    deleteSubscription(c.get('deps').sqlite, userId(c), endpoint);
    return c.body(null, 204);
  })
  .get('/api/v1/notifications', (c) => {
    const query = parseQuery(c, notificationQuery);
    return c.json(
      listNotifications(c.get('deps').sqlite, userId(c), {
        unread: query.unread === '1',
        limit: query.limit,
        kind: query.kind,
      }),
    );
  })
  .post('/api/v1/notifications/:id/read', (c) => {
    if (!markRead(c.get('deps').sqlite, userId(c), c.req.param('id'))) throw new HttpError(404, 'not_found');
    return c.body(null, 204);
  })
  .get('/api/v1/notifications/stream', (c) => notificationStream(c, c.get('deps'), userId(c)))
  .post('/internal/notifications/emit', async (c) => {
    if (c.get('principal').kind !== 'service') throw new HttpError(401, 'unauthenticated');
    const trigger = await parseBody(c, NotificationTrigger);
    const result = await getNotifyRuntime(c.get('deps')).deliver(trigger);
    return c.json(result, 202);
  });
