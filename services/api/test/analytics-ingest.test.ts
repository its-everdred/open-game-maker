import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@ogm/db';

import { signJobToken } from '../src/app/job-token.js';
import { JOB_SECRET, makeApp } from './helpers.js';

const gameId = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';
const jobId = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
const familyId = 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02';
const userId = 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03';

const fixture = JSON.parse(
  readFileSync(new URL('../../../packages/contracts/fixtures/analytics/ingest.request.json', import.meta.url), 'utf8'),
) as { events: Array<Record<string, unknown>> };

function jobHeaders(input = { jobId, gameId, familyId }) {
  return {
    authorization: `Bearer ${signJobToken(input, JOB_SECRET)}`,
    'content-type': 'application/json',
  };
}

describe('POST /api/v1/analytics/events', () => {
  it('records a visitor’s activity against a published game’s family', async () => {
    const { app, deps } = await makeApp();
    deps.db
      .insert(schema.families)
      .values({ id: familyId, name: 'Family', ownerUserId: userId, createdAt: '2026-11-01' })
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: gameId,
        familyId,
        ownerId: userId,
        title: 'Game',
        visibility: 'listed',
        repoVisibility: 'private',
        publishedReleaseId: 'release',
        createdAt: '2026-11-01',
      })
      .run();
    deps.registry.principalResolvers.push(async () => ({
      kind: 'user',
      userId: 'visitor',
      familyId: '',
      platformRole: 'none',
      capability: 'player',
    }));
    deps.registry.gameResolver = async () => ({ familyId, ownerId: userId, visibility: 'listed' });
    const human = {
      ...fixture.events[0],
      jobId: undefined,
      actor: 'human',
      source: 'editor',
      ts: '2026-10-31T09:12:04Z',
    };
    const response = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [human] }),
    });
    expect(response.status).toBe(202);
    expect(deps.sqlite.prepare('SELECT family_id FROM activity_events').get()).toEqual({ family_id: familyId });
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts the worked fixture and rejects prompt metadata independently', async () => {
    const { app, deps } = await makeApp();
    const invalid = structuredClone(fixture.events[0]);
    invalid.ts = '2026-10-31T09:12:04Z';
    invalid.meta = { command: 'gm verify', prompt: 'make it scarier' };

    const response = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: jobHeaders(),
      body: JSON.stringify({ events: [fixture.events[0], invalid] }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: 1,
      rejected: [{ index: 1, reason: 'meta: unrecognized key prompt' }],
    });
    expect(
      deps.sqlite
        .prepare('SELECT game_id, job_id, family_id, principal_kind, principal_id, meta_json FROM activity_events')
        .get(),
    ).toEqual({
      game_id: gameId,
      job_id: jobId,
      family_id: familyId,
      principal_kind: 'job',
      principal_id: jobId,
      meta_json: JSON.stringify({ command: 'gm verify', system: 'combat' }),
    });
    expect(JSON.stringify(deps.lines)).not.toContain('make it scarier');
    deps.sqlite.close();
  });

  it('rejects cross-game and cross-job token events without writing them', async () => {
    const { app, deps } = await makeApp();
    const wrongGame = { ...fixture.events[0], gameId: 'g_00000000-0000-4000-8000-000000000099' };
    const wrongJob = { ...fixture.events[0], jobId: 'j_00000000-0000-4000-8000-000000000099' };
    const response = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: jobHeaders(),
      body: JSON.stringify({ events: [wrongGame, wrongJob] }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: 0,
      rejected: [
        { index: 0, reason: 'game_mismatch' },
        { index: 1, reason: 'job_mismatch' },
      ],
    });
    expect(deps.sqlite.prepare('SELECT count(*) FROM activity_events').pluck().get()).toBe(0);
    deps.sqlite.close();
  });

  it('allows only human jobless events from a user-resolved family', async () => {
    const { app, deps } = await makeApp();
    deps.registry.principalResolvers.push(async (c) =>
      c.req.header('x-test-user')
        ? { kind: 'user', userId, displayName: 'Test User', familyId, platformRole: 'none', capability: 'creator' }
        : null,
    );
    deps.registry.gameResolver = async (id) =>
      id === gameId ? { familyId, ownerId: userId, visibility: 'private' } : null;
    const agent = { ...fixture.events[0], jobId: undefined };
    const human = { ...agent, ts: '2026-10-31T09:12:04Z', actor: 'human', source: 'editor' };
    const withJob = { ...human, ts: '2026-10-31T09:12:05Z', jobId };
    const response = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': '1' },
      body: JSON.stringify({ events: [agent, withJob, human] }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: 1,
      rejected: [
        { index: 0, reason: 'actor_not_human' },
        { index: 1, reason: 'job_not_allowed' },
      ],
    });
    expect(deps.sqlite.prepare('SELECT principal_kind, principal_id FROM activity_events').get()).toEqual({
      principal_kind: 'user',
      principal_id: userId,
    });

    deps.registry.gameResolver = null;
    const unresolved = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': '1' },
      body: JSON.stringify({ events: [human] }),
    });
    expect(unresolved.status).toBe(403);
    expect(await unresolved.json()).toEqual({ error: 'game_unresolved' });

    deps.registry.gameResolver = async () => ({
      familyId: 'f_00000000-0000-4000-8000-000000000099',
      ownerId: userId,
      visibility: 'private',
    });
    const crossFamily = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': '1' },
      body: JSON.stringify({ events: [human] }),
    });
    expect(crossFamily.status).toBe(403);
    expect(await crossFamily.json()).toEqual({ error: 'game_unresolved' });
    deps.sqlite.close();
  });

  it('normalizes timestamps, truncates commands, collapses duplicates, and checks bounds', async () => {
    const { app, deps } = await makeApp();
    const longCommand = `gm ${'x'.repeat(150)}`;
    const current = { ...fixture.events[0], ts: new Date().toISOString(), meta: { command: longCommand } };
    const offsetTime = new Date(Date.parse(current.ts) - 7 * 60 * 60 * 1000).toISOString().replace('Z', '-07:00');
    const duplicate = { ...structuredClone(current), ts: offsetTime };
    const old = { ...current, ts: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() };
    const future = { ...current, ts: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
    const badCommand = { ...current, ts: new Date(Date.now() + 1000).toISOString(), meta: { command: 'npm test' } };
    const response = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: jobHeaders(),
      body: JSON.stringify({ events: [current, duplicate, old, future, badCommand] }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: 1,
      rejected: [
        { index: 2, reason: 'ts_out_of_range' },
        { index: 3, reason: 'ts_out_of_range' },
        { index: 4, reason: 'meta.command_invalid' },
      ],
    });
    const stored = deps.sqlite.prepare('SELECT ts, meta_json FROM activity_events').get() as {
      ts: string;
      meta_json: string;
    };
    expect(stored.ts).toBe(new Date(current.ts).toISOString());
    expect((JSON.parse(stored.meta_json) as { command: string }).command).toHaveLength(120);

    const invalidEnvelope = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: jobHeaders(),
      body: JSON.stringify({ events: [] }),
    });
    expect(invalidEnvelope.status).toBe(400);
    deps.sqlite.close();
  });

  it('rolls back all accepted events when one insert fails', async () => {
    const { app, deps } = await makeApp();
    deps.sqlite.exec(
      `CREATE TRIGGER fail_audio BEFORE INSERT ON activity_events
       WHEN NEW.activity = 'audio' BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END`,
    );
    const first = { ...fixture.events[0], boundary: 'point', source: 'skill' };
    const second = { ...first, ts: '2026-10-31T09:12:04Z', activity: 'audio' };
    const response = await app.request('/api/v1/analytics/events', {
      method: 'POST',
      headers: jobHeaders(),
      body: JSON.stringify({ events: [first, second] }),
    });

    expect(response.status).toBe(500);
    expect(deps.sqlite.prepare('SELECT count(*) FROM activity_events').pluck().get()).toBe(0);
    deps.sqlite.close();
  });
});
