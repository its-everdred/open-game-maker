import { randomUUID } from 'node:crypto';

import { AiurEventFeedError, AiurHttpError, subscribeEvents } from '@ogm/aiur-client';
import { schema, type Db } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { FEED_PATTERNS, type FeedDeps, type RunningDaemon } from './types.js';

type Consumer = { controller: AbortController; done: Promise<void> };

export function readCursor(db: Db, slug: string): number {
  return db.select().from(schema.aiurCursors).where(eq(schema.aiurCursors.daemonSlug, slug)).get()?.lastSeq ?? 0;
}

// A reset jumps the cursor to head_seq; the events in between are gone from the feed, so it may move backwards.
export function writeCursor(db: Db, slug: string, lastSeq: number, epoch: string | null, now: Date): void {
  const values = { lastSeq, epoch, updatedAt: now.toISOString() };
  db.insert(schema.aiurCursors)
    .values({ daemonSlug: slug, ...values })
    .onConflictDoUpdate({ target: schema.aiurCursors.daemonSlug, set: values })
    .run();
}

// One events:feed subscription per running daemon, resumed from the persisted cursor.
export function createConsumers(deps: FeedDeps) {
  const subscribe = deps.subscribe ?? subscribeEvents;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const consumers = new Map<string, Consumer>();
  // Daemons whose feed ended for good (feature_disabled); retried only after the daemon leaves the running list.
  const ended = new Set<string>();

  async function resync(daemon: RunningDaemon): Promise<void> {
    for (const job of await deps.activeJobs(daemon.slug)) {
      try {
        deps.apply.issue(daemon.slug, job.ticket, await daemon.client.issue(job.ticket));
      } catch (error) {
        if (error instanceof AiurHttpError && error.status === 404 && deps.onMissingIssue) {
          try {
            await deps.onMissingIssue(daemon.slug, job.ticket);
          } catch (recoveryError) {
            log({
              event: 'aiur-issue-recovery-failed',
              daemon: daemon.slug,
              ticket: job.ticket,
              error: String(recoveryError),
            });
          }
          continue;
        }
        log({ event: 'aiur-issue-read-failed', daemon: daemon.slug, ticket: job.ticket, error: String(error) });
      }
    }
  }

  function start(daemon: RunningDaemon): void {
    const controller = new AbortController();
    const done = subscribe(daemon.client, {
      after: readCursor(deps.db, daemon.slug),
      patterns: FEED_PATTERNS,
      signal: controller.signal,
      // A failed write leaves the persisted cursor behind it, so the record replays after a restart.
      onRecord: (record) => {
        try {
          deps.apply.record(daemon.slug, record);
        } catch (error) {
          log({ event: 'aiur-record-apply-failed', daemon: daemon.slug, seq: record.seq, error: String(error) });
        }
      },
      onReset: (reset) => {
        const epoch = typeof reset.epoch === 'string' ? reset.epoch : `local-reset:${randomUUID()}`;
        deps.db.transaction(() => {
          writeCursor(deps.db, daemon.slug, Number(reset.head_seq), epoch, now());
          deps.onFeedReset?.(daemon.slug);
        });
        void resync(daemon);
      },
      onError: (error) => {
        if (error instanceof AiurEventFeedError && error.code === 'feature_disabled') {
          deps.alert?.(`aiur event feed is disabled on ${daemon.slug}; events.export.enabled must be true`);
        } else {
          log({ event: 'aiur-feed-error', daemon: daemon.slug, error: error.message });
        }
      },
    })
      .catch((error: unknown) => log({ event: 'aiur-feed-failed', daemon: daemon.slug, error: String(error) }))
      .finally(() => {
        if (consumers.get(daemon.slug)?.controller !== controller) return;
        consumers.delete(daemon.slug);
        if (!controller.signal.aborted) ended.add(daemon.slug);
      });
    consumers.set(daemon.slug, { controller, done });
  }

  return {
    // Starts a consumer for each newly running daemon and stops those no longer listed.
    async reconcile(running: RunningDaemon[]): Promise<void> {
      const live = new Set(running.map((daemon) => daemon.slug));
      for (const [slug, consumer] of consumers) {
        if (!live.has(slug)) {
          consumer.controller.abort();
          consumers.delete(slug);
          await consumer.done;
        }
      }
      for (const slug of ended) if (!live.has(slug)) ended.delete(slug);
      for (const daemon of running) {
        if (!consumers.has(daemon.slug) && !ended.has(daemon.slug)) start(daemon);
      }
    },
    resync,
    active: () => [...consumers.keys()],
    async stop(): Promise<void> {
      const all = [...consumers.values()];
      consumers.clear();
      for (const consumer of all) consumer.controller.abort();
      await Promise.all(all.map((consumer) => consumer.done));
    },
  };
}
