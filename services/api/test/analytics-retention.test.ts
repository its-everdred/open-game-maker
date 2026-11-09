import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadApiEnv } from '../src/app/env.js';
import { startAnalyticsRetention, sweepAnalytics } from '../src/analytics/retention.js';
import { makeApiEnv } from './env-fixture.js';
import { makeDeps } from './helpers.js';

const baseEnv = makeApiEnv();

describe('analytics retention', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to 90 days and rejects non-positive retention', () => {
    expect(loadApiEnv(baseEnv)).toMatchObject({
      OGM_ANALYTICS_RETENTION_DAYS: 90,
      OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD: 5_000_000,
      OGM_INTAKE_SWEEP_SECONDS: 60,
    });
    expect(() => loadApiEnv({ ...baseEnv, OGM_ANALYTICS_RETENTION_DAYS: '0' })).toThrow(/OGM_ANALYTICS_RETENTION_DAYS/);
    expect(() => loadApiEnv({ ...baseEnv, OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD: '0' })).toThrow(
      /OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD/,
    );
    expect(() => loadApiEnv({ ...baseEnv, OGM_COMMAND_POLL_MS: '0' })).toThrow(/OGM_COMMAND_POLL_MS/);
    expect(() => loadApiEnv({ ...baseEnv, OGM_INTAKE_SWEEP_SECONDS: '0' })).toThrow(/OGM_INTAKE_SWEEP_SECONDS/);
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
