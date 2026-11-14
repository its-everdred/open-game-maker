import type { NotificationTrigger, PushSubscriptionInput } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { deliver, deliverStored } from '../src/notify/deliver.js';
import { render } from '../src/notify/render.js';
import { insertNotification, listNotifications, subscriptionsFor, upsertSubscription } from '../src/notify/store.js';
import { createStreamHub } from '../src/notify/stream.js';
import { makeDeps } from './helpers.js';

const ids = {
  userOne: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03',
  userTwo: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e04',
  game: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01',
  job: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
};

const buildTrigger: NotificationTrigger = {
  kind: 'build.done',
  userIds: [ids.userOne, ids.userTwo],
  gameId: ids.game,
  jobId: ids.job,
  buildId: 'build-1',
  ok: true,
};

function subscription(endpoint: string): PushSubscriptionInput {
  return { endpoint, expirationTime: null, keys: { p256dh: `p256dh-${endpoint}`, auth: `auth-${endpoint}` } };
}

describe('notification rendering', () => {
  it('renders all three trigger kinds with the fixed copy and URLs', () => {
    expect(render(buildTrigger, {})).toEqual({
      title: 'Your build is ready',
      body: ids.game,
      url: `/play/${ids.game}`,
    });
    expect(render({ ...buildTrigger, ok: false }, {})).toMatchObject({ title: 'A build needs you' });
    expect(render({ kind: 'job.started', userIds: [ids.userOne], gameId: ids.game, jobId: ids.job }, {})).toEqual({
      title: 'Your queued change started',
      body: ids.game,
      url: `/play/${ids.game}?chat=${ids.job}`,
    });
    expect(
      render({ kind: 'intake.report', userIds: [ids.userOne], dropId: 'drop-1', status: 'awaiting-license' }, {}),
    ).toEqual({ title: 'New assets arrived', body: 'drop-1: awaiting-license', url: '/admin/intake' });
  });
});

describe('deliver', () => {
  it('pushes an existing reminder without writing a second inbox item', async () => {
    const deps = makeDeps();
    upsertSubscription(deps.sqlite, ids.userOne, subscription('https://push.example.test/one'));
    const notification = insertNotification(deps.sqlite, {
      userId: ids.userOne,
      kind: 'review.reminder',
      title: 'A review is waiting',
      body: 'Lantern Bay',
    });
    const push = { sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) };
    const stream = { publish: vi.fn() };
    await deliverStored({ sqlite: deps.sqlite, stream, push }, notification);
    expect(push.sendNotification).toHaveBeenCalledOnce();
    expect(stream.publish).toHaveBeenCalledWith(ids.userOne, notification);
    expect(listNotifications(deps.sqlite, ids.userOne, {})).toHaveLength(1);
  });
  it('inserts one row per recipient, publishes each row, and pushes the minimal payload', async () => {
    const deps = makeDeps();
    upsertSubscription(deps.sqlite, ids.userOne, subscription('https://push.example.test/one'));
    upsertSubscription(deps.sqlite, ids.userOne, subscription('https://push.example.test/two'));
    upsertSubscription(deps.sqlite, ids.userTwo, subscription('https://push.example.test/three'));
    const published: string[] = [];
    const hub = createStreamHub();
    hub.attach(ids.userOne, {
      write: async (frame) => {
        published.push(frame);
      },
      close: async () => {},
    });
    hub.attach(ids.userTwo, {
      write: async (frame) => {
        published.push(frame);
      },
      close: async () => {},
    });
    const sendNotification = vi.fn().mockResolvedValue({ statusCode: 201 });

    await expect(
      deliver({ sqlite: deps.sqlite, stream: hub, push: { sendNotification } }, buildTrigger),
    ).resolves.toEqual({
      delivered: 2,
    });

    expect(listNotifications(deps.sqlite, ids.userOne, {})).toHaveLength(1);
    expect(listNotifications(deps.sqlite, ids.userTwo, {})).toHaveLength(1);
    expect(published).toHaveLength(2);
    expect(sendNotification).toHaveBeenCalledTimes(3);
    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(payload).toEqual({
      id: expect.stringMatching(/^n_/),
      kind: 'build.done',
      title: 'Your build is ready',
      body: ids.game,
      url: `/play/${ids.game}`,
    });
    expect(sendNotification.mock.calls[0][2]).toEqual({ TTL: 3600, urgency: 'normal', timeout: 10_000 });
  });

  it('deletes 404/410 subscriptions and drops other failures after five attempts without rejecting delivery', async () => {
    const deps = makeDeps();
    upsertSubscription(deps.sqlite, ids.userOne, subscription('https://push.example.test/gone'));
    const gone = vi.fn().mockRejectedValue({ statusCode: 410 });
    await expect(
      deliver({ sqlite: deps.sqlite, stream: createStreamHub(), push: { sendNotification: gone } }, buildTrigger),
    ).resolves.toEqual({ delivered: 2 });
    expect(subscriptionsFor(deps.sqlite, ids.userOne)).toHaveLength(0);

    upsertSubscription(deps.sqlite, ids.userOne, subscription('https://push.example.test/flaky'));
    const failing = vi.fn().mockRejectedValue({ statusCode: 500 });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await deliver(
        { sqlite: deps.sqlite, stream: createStreamHub(), push: { sendNotification: failing } },
        buildTrigger,
      );
      expect(subscriptionsFor(deps.sqlite, ids.userOne)).toMatchObject([{ failures: attempt }]);
    }
    await expect(
      deliver({ sqlite: deps.sqlite, stream: createStreamHub(), push: { sendNotification: failing } }, buildTrigger),
    ).resolves.toEqual({ delivered: 2 });
    expect(subscriptionsFor(deps.sqlite, ids.userOne)).toHaveLength(0);
  });
});
