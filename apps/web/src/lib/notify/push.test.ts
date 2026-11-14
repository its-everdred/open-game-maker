import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Notify = typeof import('./index') & typeof import('./slice');

let notify: Notify;
let calls: { url: string; init?: RequestInit }[];

function respond(routes: Record<string, () => Response>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return routes[url]?.() ?? new Response('', { status: 404 });
    }),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  vi.resetModules();
  notify = { ...(await import('./index')), ...(await import('./slice')) };
  const subscription = {
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'pk', auth: 'au' }, expirationTime: null }),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { subscribe: vi.fn(async () => subscription) } }) },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('subscribePush', () => {
  it('registers the browser subscription with the backend', async () => {
    respond({
      '/api/v1/push/vapid-public-key': () => json({ publicKey: 'BEl6' }),
      '/api/v1/push/subscriptions': () => json({}, 201),
    });

    await notify.subscribePush();

    const post = calls.find((c) => c.url === '/api/v1/push/subscriptions');
    expect(post?.init?.method).toBe('POST');
    expect(JSON.parse(post!.init!.body as string)).toEqual({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'pk', auth: 'au' },
    });
  });

  it('posts nothing while the backend has no push key route yet', async () => {
    respond({});

    await expect(notify.subscribePush()).rejects.toMatchObject({ name: 'ApiError', status: 404 });
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/push/vapid-public-key']);
  });
});

describe('requestPushPermission', () => {
  it('remembers a denial so the prompt is not offered again', async () => {
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'denied') });
    expect(notify.canAskForPush()).toBe(true);

    await notify.requestPushPermission();

    expect(notify.canAskForPush()).toBe(false);
  });
});

describe('useNotificationFeed', () => {
  class FakeEventSource extends EventTarget {
    static CLOSED = 2;
    static instances: FakeEventSource[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    close = vi.fn();
    constructor(public url: string) {
      super();
      FakeEventSource.instances.push(this);
    }
    fail() {
      this.readyState = FakeEventSource.CLOSED;
      this.onerror?.();
    }
  }

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => vi.useRealTimers());

  it('shows a notification title and body for a finished build', () => {
    const listener = vi.fn();
    const unsubscribe = notify.subscribeNotification(listener);
    const { unmount } = renderHook(() => notify.useNotificationFeed());
    const source = FakeEventSource.instances.at(-1)!;

    expect(source.url).toBe('/api/v1/notifications/stream');
    source.dispatchEvent(
      new MessageEvent('build.done', {
        data: JSON.stringify({ title: 'Build complete', body: 'Mossy Leap is built', url: '/builds/1' }),
      }),
    );

    expect(notify.notifyState().toasts.map((t) => t.text)).toEqual(['Build complete — Mossy Leap is built']);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('build.done', expect.any(MessageEvent));
    unsubscribe();
    unmount();
    expect(source.close).toHaveBeenCalled();
  });

  it('shows the notification body when the title is empty', () => {
    const { unmount } = renderHook(() => notify.useNotificationFeed());
    const source = FakeEventSource.instances.at(-1)!;

    source.dispatchEvent(
      new MessageEvent('job.started', { data: JSON.stringify({ title: '', body: 'Build started' }) }),
    );

    expect(notify.notifyState().toasts.map((t) => t.text)).toEqual(['Build started']);
    unmount();
  });

  it('shows a review reminder from the notification stream', () => {
    const { unmount } = renderHook(() => notify.useNotificationFeed());
    const source = FakeEventSource.instances.at(-1)!;
    source.dispatchEvent(
      new MessageEvent('review.reminder', {
        data: JSON.stringify({ title: 'A review is waiting', body: 'Lantern Bay' }),
      }),
    );
    expect(notify.notifyState().toasts.map((toast) => toast.text)).toEqual(['A review is waiting — Lantern Bay']);
    unmount();
  });

  it('shows an unread review reminder after reconnecting and marks it read', async () => {
    respond({
      '/api/v1/notifications?unread=1&kind=review.reminder&limit=100': () =>
        json([{ id: 'n-1', kind: 'review.reminder', title: 'A review is waiting', body: 'Lantern Bay' }]),
      '/api/v1/notifications/n-1/read': () => new Response(null, { status: 204 }),
    });
    const { unmount } = renderHook(() => notify.useNotificationFeed());
    const source = FakeEventSource.instances.at(-1)!;
    source.onopen?.();
    await waitFor(() =>
      expect(notify.notifyState().toasts.map((toast) => toast.text)).toEqual(['A review is waiting — Lantern Bay']),
    );
    expect(calls.some((call) => call.url === '/api/v1/notifications/n-1/read' && call.init?.method === 'POST')).toBe(
      true,
    );
    source.dispatchEvent(
      new MessageEvent('review.reminder', {
        data: JSON.stringify({ id: 'n-1', title: 'A review is waiting', body: 'Lantern Bay' }),
      }),
    );
    expect(notify.notifyState().toasts).toHaveLength(1);
    unmount();
  });

  it('shares one connection until the final feed user unmounts', () => {
    const first = renderHook(() => notify.useNotificationFeed());
    const second = renderHook(() => notify.useNotificationFeed());
    const source = FakeEventSource.instances[0]!;

    expect(FakeEventSource.instances).toHaveLength(1);
    first.unmount();
    expect(source.close).not.toHaveBeenCalled();

    second.unmount();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it('keeps a shared listener until its final subscriber unmounts', () => {
    const listener = vi.fn();
    const first = notify.subscribeNotification(listener);
    const second = notify.subscribeNotification(listener);
    const feed = renderHook(() => notify.useNotificationFeed());
    const source = FakeEventSource.instances[0]!;

    first();
    source.dispatchEvent(new MessageEvent('job.started', { data: 'Build started' }));
    expect(listener).toHaveBeenCalledOnce();

    second();
    source.dispatchEvent(new MessageEvent('job.started', { data: 'Another build started' }));
    expect(listener).toHaveBeenCalledOnce();
    feed.unmount();
  });

  it('stops reopening after five failed open attempts', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => notify.useNotificationFeed());

    for (let failedAttempt = 1; failedAttempt < 5; failedAttempt++) {
      FakeEventSource.instances.at(-1)!.fail();
      await vi.advanceTimersByTimeAsync(1000 * 2 ** failedAttempt);
      expect(FakeEventSource.instances).toHaveLength(failedAttempt + 1);
    }

    FakeEventSource.instances.at(-1)!.fail();
    await vi.runOnlyPendingTimersAsync();
    expect(FakeEventSource.instances).toHaveLength(5);
    unmount();
  });
});
