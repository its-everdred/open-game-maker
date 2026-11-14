import { useEffect } from 'react';

import { api, sse } from '../api/client';
import { pushToast } from './slice';

// One SSE connection for the whole app, shared by every screen that shows the feed. EventSource reconnects by itself
// after a dropped connection; a stream that never opens (OGM-016 not merged, signed out) gets at most five open
// attempts (four retries) with backoff and is then left closed.
const EVENTS = ['build.done', 'job.started', 'intake.report', 'review.reminder'] as const;
type NotificationKind = (typeof EVENTS)[number];
type NotificationListener = (kind: NotificationKind, event: MessageEvent<string>) => void;
const MAX_FAILED_OPENS = 5;

let users = 0;
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let failedOpens = 0;
const listeners = new Map<NotificationListener, number>();
const seenReminders = new Set<string>();

function showReminder(message: MessageEvent<string>): void {
  let id: unknown;
  try {
    id = (JSON.parse(message.data) as { id?: unknown }).id;
  } catch {
    /* Ignore malformed IDs. */
  }
  if (typeof id === 'string') {
    if (seenReminders.has(id)) return;
    seenReminders.add(id);
    void api(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(() =>
      seenReminders.delete(id as string),
    );
  }
  pushToast(toastText(message));
  for (const listener of listeners.keys()) listener('review.reminder', message);
}

export function subscribeNotification(listener: NotificationListener): () => void {
  listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const subscriberCount = listeners.get(listener) ?? 0;
    if (subscriberCount <= 1) listeners.delete(listener);
    else listeners.set(listener, subscriberCount - 1);
  };
}

export function useNotificationFeed(): void {
  useEffect(() => {
    if (users++ === 0) open();
    return () => {
      if (--users === 0) close();
    };
  }, []);
}

function open(): void {
  const es = (source = sse('/notifications/stream'));
  es.onopen = () => {
    failedOpens = 0;
    void api<Array<{ id: string; kind: string; title: string; body: string }>>(
      '/notifications?unread=1&kind=review.reminder&limit=100',
    )
      .then((items) => {
        if (source !== es) return;
        for (const item of items)
          if (item.kind === 'review.reminder')
            showReminder(new MessageEvent('review.reminder', { data: JSON.stringify(item) }));
      })
      .catch(() => {});
  };
  for (const name of EVENTS) {
    es.addEventListener(name, (event) => {
      const message = event as MessageEvent<string>;
      if (name === 'review.reminder') {
        showReminder(message);
        return;
      }
      pushToast(toastText(message));
      for (const listener of listeners.keys()) listener(name, message);
    });
  }
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) return;
    source = null;
    if (++failedOpens >= MAX_FAILED_OPENS) return;
    retry = setTimeout(
      () => {
        if (users > 0 && !source) open();
      },
      1000 * 2 ** failedOpens,
    );
  };
}

function close(): void {
  clearTimeout(retry);
  source?.close();
  source = null;
  failedOpens = 0;
}

function toastText(e: MessageEvent<string>): string {
  try {
    const data = JSON.parse(e.data) as { title?: unknown; body?: unknown };
    const title = typeof data.title === 'string' ? data.title : undefined;
    const body = typeof data.body === 'string' ? data.body : undefined;
    const text = [title, body].filter((value): value is string => Boolean(value)).join(' — ');
    if (text) return text;
  } catch {
    /* plain text payload */
  }
  return e.data;
}
