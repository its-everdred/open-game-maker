import type { Notification } from '@ogm/contracts';

import type { AppDeps } from '../app/types.js';
import { insertNotification } from '../notify/store.js';
import { hasRecentReviewNotification } from '../review-rounds/notification-cooldown.js';

// "Your review is ready", "X is live" and "stalled: cause, action, ETA" reach the owner's phone as one push each
// (#854 Notify). aiur publishes them on the core daemon as `operator.notify.<kind>` (aiur-team/aiur#8034); this reads
// that feed and sends each once. In the app they stay out of the toasts: the thread's badge is the only sign (#878).
export const EXECUTOR_NOTIFY_TOPIC = 'operator.notify.*';
const KINDS = new Set(['review_ready', 'live', 'stalled', 'info']);
const PAGE = 100;
// A notice older than this is history, not news: a restart or a first deploy does not replay it.
const MAX_AGE_MS = 60 * 60 * 1000;
// How far back a fresh process looks, so a notice published while it restarted still arrives.
const LOOKBACK = 200;

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function sent(deps: AppDeps, key: string): boolean {
  return (
    deps.sqlite
      .prepare(
        "SELECT 1 FROM notifications WHERE kind = 'executor.notify' AND json_extract(data_json, '$.eventKey') = ? LIMIT 1",
      )
      .get(key) !== undefined
  );
}

export function createExecutorNotifier(
  deps: AppDeps,
  options: { deliver(notification: Notification): Promise<void>; now?: () => Date },
) {
  let after: number | undefined;
  let running = false;
  return async () => {
    const client = deps.registry.coreAiurClient;
    const owner = deps.config.instanceOwnerId;
    if (!client || !owner || running) return;
    running = true;
    try {
      if (after === undefined) {
        const head = await client.events(0, 1, [EXECUTOR_NOTIFY_TOPIC]);
        after = Math.max(0, head.head_seq - LOOKBACK);
      }
      const now = options.now?.() ?? new Date();
      for (;;) {
        const from: number = after;
        const page = await client.events(from, PAGE, [EXECUTOR_NOTIFY_TOPIC]);
        for (const record of page.records) {
          if (record.type === 'reset') {
            after = record.head_seq;
            continue;
          }
          if (record.type !== 'event' && record.type !== 'gap') continue;
          after = Math.max(after, record.seq);
          if (record.type !== 'event') continue;
          const kind = record.topic.slice('operator.notify.'.length);
          if (!record.topic.startsWith('operator.notify.') || !KINDS.has(kind)) continue;
          const at = Date.parse(text(record.payload.created_at, 40) ?? record.occurred_at ?? record.observed_at);
          if (!Number.isFinite(at) || now.getTime() - at > MAX_AGE_MS) continue;
          const key = `${page.instance}:${record.id}`;
          if (sent(deps, key)) continue;
          const ticket = record.payload.ticket;
          const reviewTicketKey =
            kind === 'review_ready' && (typeof ticket === 'string' || typeof ticket === 'number')
              ? `core:${String(ticket)}`
              : undefined;
          if (reviewTicketKey && hasRecentReviewNotification(deps.db, owner, reviewTicketKey, now)) continue;
          const notification = insertNotification(
            deps.sqlite,
            {
              userId: owner,
              kind: 'executor.notify',
              title: text(record.payload.title, 120) ?? kind.replace('_', ' '),
              body: text(record.payload.body, 400) ?? '',
              // The app, not the link aiur names: everything the owner needs is in the app.
              url: '/all',
              data: {
                eventKey: key,
                notice: kind,
                ...(typeof ticket === 'string' || typeof ticket === 'number' ? { ticket: String(ticket) } : {}),
                ...(reviewTicketKey ? { reviewTicketKey } : {}),
              },
            },
            { now },
          );
          try {
            await options.deliver(notification);
          } catch (error) {
            deps.log({ event: 'executor_notify_delivery_error', error: (error as Error).name });
          }
        }
        if (page.records.length < PAGE || after <= from) break;
      }
    } finally {
      running = false;
    }
  };
}
