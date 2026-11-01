import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadApiEnv } from '../src/app/env.js';
import { startAnalyticsRetention, sweepAnalytics } from '../src/analytics/retention.js';
import { makeDeps } from './helpers.js';

const baseEnv = {
  OGM_API_PORT: '4000',
  OGM_DATA_DIR: '/tmp/ogm-test',
  OGM_INTERNAL_TOKEN: 'internal-token-for-tests-0123456789',
  OGM_JOB_TOKEN_SECRET: 'job-token-secret-for-tests-0123456789',
  OGM_BLOB_ROOT: '/tmp/ogm-blobs-test',
  OGM_BLOB_SIGNING_KEY: 'blob-signing-key-for-tests-with-32-bytes',
  OGM_PUBLIC_ORIGIN: 'https://api.example.test',
  OGM_APP_ORIGIN: 'https://app.example.test',
  OGM_ROOMS_INTERNAL_URL: 'http://127.0.0.1:4302',
  OGM_ROOMS_INTERNAL_SECRET: 'rooms-internal-secret-for-tests',
  OGM_WS_TOKEN_SECRET: 'room-grant-secret-for-tests-with-32-bytes',
  OGM_COMMIT_INTERNAL_URL: 'http://127.0.0.1:4301',
  OGM_COMMIT_SERVICE_TOKEN: 'commit-service-token-for-tests',
  OGM_VAPID_SUBJECT: 'operator@example.test',
};

describe('analytics retention', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to 90 days and rejects non-positive retention', () => {
    expect(loadApiEnv(baseEnv).OGM_ANALYTICS_RETENTION_DAYS).toBe(90);
    expect(() => loadApiEnv({ ...baseEnv, OGM_ANALYTICS_RETENTION_DAYS: '0' })).toThrow(/OGM_ANALYTICS_RETENTION_DAYS/);
  });

  it('deletes only expired activity events and keeps phase history', () => {
    const deps = makeDeps();
    const insert = deps.sqlite.prepare(
      `INSERT INTO activity_events
        (id, ts, received_at, family_id, game_id, job_id, actor, activity, boundary, source, meta_json,
         principal_kind, principal_id)
       VALUES (?, ?, ?, ?, ?, ?, 'agent', 'playtesting', 'point', 'skill', '{}', 'job', ?)`,
    );
    const familyId = 'f_00000000-0000-4000-8000-000000000001';
    const gameId = 'g_00000000-0000-4000-8000-000000000001';
    const jobId = 'j_00000000-0000-4000-8000-000000000001';
    insert.run(
      'i_00000000-0000-4000-8000-000000000001',
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      familyId,
      gameId,
      jobId,
      jobId,
    );
    insert.run(
      'i_00000000-0000-4000-8000-000000000002',
      '2026-10-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      familyId,
      gameId,
      jobId,
      jobId,
    );
    deps.sqlite
      .prepare('INSERT INTO aiur_phase_events (job_id, phase, at, source) VALUES (?, ?, ?, ?)')
      .run(jobId, 'work', '2026-07-01T00:00:00.000Z', 'events_feed');

    expect(sweepAnalytics(deps.sqlite, 90, new Date('2026-11-01T00:00:00.000Z'))).toBe(1);
    expect(deps.sqlite.prepare('SELECT id FROM activity_events ORDER BY id').pluck().all()).toEqual([
      'i_00000000-0000-4000-8000-000000000002',
    ]);
    expect(deps.sqlite.prepare('SELECT phase FROM aiur_phase_events').pluck().all()).toEqual(['work']);
    deps.sqlite.close();
  });

  it('runs immediately and daily until stopped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
    const deps = makeDeps();
    const stop = startAnalyticsRetention({
      sqlite: deps.sqlite,
      retentionDays: 90,
      log: deps.log,
    });

    expect(deps.lines).toEqual([{ event: 'analytics_retention', deleted: 0 }]);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(deps.lines).toHaveLength(2);

    stop();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(deps.lines).toHaveLength(2);
    deps.sqlite.close();
  });

  it('logs sweep failures without throwing and still returns cleanup', () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    deps.sqlite.close();

    const stop = startAnalyticsRetention({
      sqlite: deps.sqlite,
      retentionDays: 90,
      log: deps.log,
    });

    expect(deps.lines).toEqual([{ event: 'analytics_retention_failed', error: 'TypeError' }]);
    expect(() => stop()).not.toThrow();
  });
});
