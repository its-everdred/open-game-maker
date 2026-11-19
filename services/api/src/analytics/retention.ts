import type { Sqlite } from '@ogm/db';

import type { LogLine } from '../app/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function sweepAnalytics(sqlite: Sqlite, retentionDays: number, now = new Date()): number {
  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
    throw new RangeError('analytics retention days must be a positive integer');
  }
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  return sqlite.prepare('DELETE FROM activity_events WHERE ts < ?').run(cutoff).changes;
}

export function sweepPlaySessions(sqlite: Sqlite, now = new Date()): number {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  return sqlite.prepare('DELETE FROM game_play_sessions WHERE created_at < ?').run(cutoff).changes;
}

export function startAnalyticsRetention(input: {
  sqlite: Sqlite;
  retentionDays: number;
  log: (line: LogLine) => void;
  now?: () => Date;
}): () => void {
  const run = () => {
    try {
      sweepPlaySessions(input.sqlite, input.now?.() ?? new Date());
      input.log({
        event: 'analytics_retention',
        deleted: sweepAnalytics(input.sqlite, input.retentionDays, input.now?.() ?? new Date()),
      });
    } catch (error) {
      input.log({ event: 'analytics_retention_failed', error: error instanceof Error ? error.name : 'unknown' });
    }
  };

  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
