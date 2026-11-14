import type { Principal } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { insertNotification, listNotifications, subscriptionsFor } from '../src/notify/store.js';
import { INTERNAL_TOKEN, makeApp } from './helpers.js';

const users = {
  one: {
    kind: 'user',
    userId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03',
    displayName: 'One',
    familyId: 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02',
    platformRole: 'none',
    capability: 'creator',
  },
  two: {
    kind: 'user',
    userId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e04',
    displayName: 'Two',
    familyId: 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02',
    platformRole: 'none',
    capability: 'creator',
  },
} as const satisfies Record<string, Principal>;

async function setup() {
  const result = await makeApp();
  result.deps.registry.principalResolvers.push(async (c) => {
    const user = c.req.header('x-test-user');
    return user === 'one' ? users.one : user === 'two' ? users.two : null;
  });
  return result;
}

const subscription = {
  endpoint: 'https://push.example.test/subscription',
  expirationTime: null,
  keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
};

describe('notification routes', () => {
  it('returns the VAPID public key and upserts one subscription per endpoint', async () => {
    const { app, deps } = await setup();
    const publicKey = await app.request('/api/v1/push/vapid-public-key');
    expect(publicKey.status).toBe(200);
    expect(await publicKey.json()).toEqual({ publicKey: expect.any(String) });

    for (const user of ['one', 'two']) {
      const response = await app.request('/api/v1/push/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': user },
        body: JSON.stringify({ ...subscription, keys: { ...subscription.keys, auth: `auth-${user}` } }),
      });
      expect(response.status).toBe(201);
    }

    expect(subscriptionsFor(deps.sqlite, users.one.userId)).toHaveLength(0);
    expect(subscriptionsFor(deps.sqlite, users.two.userId)).toMatchObject([
      { endpoint: subscription.endpoint, auth: 'auth-two', failures: 0 },
    ]);
  });

  it('lists unread rows, marks only owned rows read, and deletes only owned subscriptions', async () => {
    const { app, deps } = await setup();
    await app.request('/api/v1/push/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'one' },
      body: JSON.stringify(subscription),
    });
    await app.request('/api/v1/push/subscriptions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-test-user': 'two' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    expect(subscriptionsFor(deps.sqlite, users.one.userId)).toHaveLength(1);
    await app.request('/api/v1/push/subscriptions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-test-user': 'one' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    expect(subscriptionsFor(deps.sqlite, users.one.userId)).toHaveLength(0);

    const unread = insertNotification(deps.sqlite, {
      userId: users.one.userId,
      kind: 'build.done',
      title: 'Your build is ready',
      body: 'game',
      url: '/games/game',
    });
    insertNotification(deps.sqlite, {
      userId: users.one.userId,
      kind: 'job.started',
      title: 'Your queued change started',
      body: 'game',
      url: '/games/game?chat=job',
      readAt: '2026-11-01T12:00:00.000Z',
    });

    const listed = await app.request('/api/v1/notifications?unread=1&limit=10', {
      headers: { 'x-test-user': 'one' },
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([expect.objectContaining({ id: unread.id, readAt: null })]);

    const remindersOnly = await app.request('/api/v1/notifications?unread=1&kind=review.reminder', {
      headers: { 'x-test-user': 'one' },
    });
    expect(await remindersOnly.json()).toEqual([]);

    const forbidden = await app.request(`/api/v1/notifications/${unread.id}/read`, {
      method: 'POST',
      headers: { 'x-test-user': 'two' },
    });
    expect(forbidden.status).toBe(404);

    const marked = await app.request(`/api/v1/notifications/${unread.id}/read`, {
      method: 'POST',
      headers: { 'x-test-user': 'one' },
    });
    expect(marked.status).toBe(204);
    expect(listNotifications(deps.sqlite, users.one.userId, { unread: true })).toHaveLength(0);
  });

  it('refuses a user principal on the internal route and accepts a service trigger', async () => {
    const { app, deps } = await setup();
    const trigger = {
      kind: 'intake.report',
      userIds: [users.one.userId],
      dropId: 'drop-1',
      status: 'imported',
    };
    const userResponse = await app.request('/internal/notifications/emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'one' },
      body: JSON.stringify(trigger),
    });
    expect(userResponse.status).toBe(401);

    const serviceResponse = await app.request('/internal/notifications/emit', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${INTERNAL_TOKEN}`,
        'content-type': 'application/json',
        'x-ogm-service': 'intake',
      },
      body: JSON.stringify(trigger),
    });
    expect(serviceResponse.status).toBe(202);
    expect(await serviceResponse.json()).toEqual({ delivered: 1 });
    expect(listNotifications(deps.sqlite, users.one.userId, {})).toHaveLength(1);

    deps.events.emit('notify', { ...trigger, dropId: 'drop-2' });
    await vi.waitFor(() => expect(listNotifications(deps.sqlite, users.one.userId, {})).toHaveLength(2));
  });
});
