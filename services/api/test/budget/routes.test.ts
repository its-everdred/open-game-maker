import { schema } from '@ogm/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { asUser, makeApp } from '../helpers.js';
import { ids, NOW, plan, RESETS_AT, worked } from './fixture.js';

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
afterEach(() => vi.useRealTimers());

const status = (app: Awaited<ReturnType<typeof makeApp>>['app'], as: string, query = '') =>
  app.request(`/api/v1/budget/status${query}`, { headers: asUser(as) });

describe('GET /api/v1/budget/status', () => {
  it('answers the worked status in the friendly unit', async () => {
    const { app } = await makeApp(worked());
    const response = await status(app, ids.creator);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      remainingMicroUsd: 2_000_000,
      dailyLimitActive: false,
      weeklyJobs: { newGames: 2, edits: 19, resetsAt: '2026-11-02T08:00:00.000Z' },
      remainingPercent: 40,
      unitLabel: 'energy',
      resetsAt: RESETS_AT,
      freeSlots: { new_game: 1, edit: 2 },
      queued: [],
      units: 20,
      label: 'energy',
    });
  });

  it("lets only an admin read another member's budget", async () => {
    const { app } = await makeApp(worked());
    expect((await status(app, ids.other, `?userId=${ids.creator}`)).status).toBe(403);
    const asAdmin = await status(app, ids.admin, `?userId=${ids.creator}`);
    expect(asAdmin.status).toBe(200);
    expect(await asAdmin.json()).toMatchObject({ remainingMicroUsd: 2_000_000 });
  });

  it('keeps dollars for admins', async () => {
    const { app } = await makeApp(worked());
    const asCreator = await status(app, ids.creator, '?unit=usd');
    expect(asCreator.status).toBe(403);
    expect(await asCreator.json()).toMatchObject({ error: 'unit_not_allowed' });
    const asAdmin = await status(app, ids.admin, `?userId=${ids.creator}&unit=usd`);
    expect(await asAdmin.json()).toMatchObject({ usd: 2 });
  });
});

describe('POST /api/v1/budget/estimate', () => {
  it('answers the worked estimate', async () => {
    const { app } = await makeApp(worked());
    const response = await app.request('/api/v1/budget/estimate', {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: ids.game, summary: 'add three new enemies and a boss' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sizeClass: 'large',
      rangeMicroUsd: [4_000_000, 9_000_000],
      confidence: 'low',
      fits: true,
    });
  });

  it('answers 404 for an unknown game', async () => {
    const { app } = await makeApp(worked());
    const response = await app.request('/api/v1/budget/estimate', {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'g_18000000-0000-4000-8000-00000000ffff', summary: 'fix the jump' }),
    });
    expect(response.status).toBe(404);
  });

  it('refuses a game the caller cannot build', async () => {
    const { app } = await makeApp(worked());
    const response = await app.request('/api/v1/budget/estimate', {
      method: 'POST',
      headers: { ...asUser(ids.other), 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: ids.game, summary: 'fix the jump' }),
    });
    expect(response.status).toBe(403);
  });
});

describe('queue_change', () => {
  // A medium change (p80 4000000) does not fit the 2000000 left today but fits tomorrow's allowance.
  it('queues an at_reset job that then shows in status', async () => {
    const deps = worked();
    deps.db
      .insert(schema.allowances)
      .values({ familyId: ids.family, userId: ids.creator, dailyMicroUsd: 5_000_000 })
      .run();
    const { app } = await makeApp(deps);
    const before = (await (await status(app, ids.creator)).json()) as { queued: string[]; freeSlots: object };
    expect(before.queued).toEqual([]);

    const create = (start: 'now' | 'at_reset') =>
      app.request('/api/v1/jobs', {
        method: 'POST',
        headers: { ...asUser(ids.creator), 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: ids.game, branchId: 'main', kind: 'feature', complexity: 2, plan, start }),
      });
    expect((await create('now')).status).toBe(402);
    const created = await create('at_reset');
    expect(created.status).toBe(202);
    const { jobId, state } = (await created.json()) as { jobId: string; state: string };
    expect(state).toBe('queued');

    const after = (await (await status(app, ids.creator)).json()) as { queued: string[]; freeSlots: object };
    expect(after.queued).toEqual([jobId]);
    expect(after.freeSlots).toEqual(before.freeSlots);
  });
});
