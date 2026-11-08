import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnergyAdminView, EnergyView, type CreateJobRequest, type EnergyLimits } from '@ogm/contracts';
import { schema } from '@ogm/db';

import { energySource } from '../../src/energy/source.js';
import { writeLimits } from '../../src/energy/store.js';
import { energyLevel } from '../../src/energy/view.js';
import { admit } from '../../src/jobs/admission.js';
import { asUser, makeApp } from '../helpers.js';
import { reserve } from '../../src/budget/ledger.js';
import { ids, insertJob, NOW, plan, RESETS_AT, worked, ZONE } from '../budget/fixture.js';

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
afterEach(() => vi.useRealTimers());

const QUEUED = 'j_18000000-0000-4000-8000-000000000002';
const NONE: EnergyLimits = { day: null, week: null, month: null, voice: null, images: null };
const json = (as: string, body: unknown) => ({
  headers: { ...asUser(as), 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// worked() holds one 3_000_000 reservation today (Saturday Oct 31 in Los Angeles).
describe('local resource-policy source', () => {
  it('sums the build ledger per calendar window and leaves voice and images unknown', () => {
    const snapshot = energySource({ db: worked().db, zone: ZONE }).snapshot(NOW);
    expect(snapshot.usage).toEqual({ day: 3_000_000, week: 3_000_000, month: 3_000_000, voice: null, images: null });
    expect(snapshot.resources).toEqual([
      {
        label: 'Builds',
        provider: 'aiur',
        kind: 'metered',
        spentMicroUsd: 3_000_000,
        remainingMicroUsd: null,
        resetsAt: null,
      },
    ]);
  });

  it('resets the week on Monday and the month on the 1st, in the zone, across the DST change', () => {
    const { resetsAt } = energySource({ db: worked().db, zone: ZONE }).snapshot(NOW);
    // Daylight time ends on Nov 1, so Monday's midnight is 08:00Z while Nov 1's is 07:00Z.
    expect(resetsAt).toEqual({ day: RESETS_AT, week: '2026-11-02T08:00:00.000Z', month: RESETS_AT });
  });

  it('counts a build queued for tomorrow in this week but not in today or, at month end, this month', () => {
    const deps = worked();
    insertJob(deps, { id: QUEUED, state: 'queued', start: 'at_reset' });
    reserve({ db: deps.db, jobId: QUEUED, at: NOW, zone: ZONE, amountMicroUsd: 2_000_000, forDay: '2026-11-01' });
    const snapshot = energySource({ db: deps.db, zone: ZONE }).snapshot(NOW);
    expect(snapshot.usage).toMatchObject({ day: 3_000_000, week: 5_000_000, month: 3_000_000 });
  });

  it("places each family's spend by that family's own calendar", () => {
    const deps = worked();
    // Kiritimati is a day ahead: its family's reservation made now is keyed Nov 1, while Los Angeles is on Oct 31.
    deps.db
      .insert(schema.familyBudgetSettings)
      .values({
        familyId: ids.family,
        resetZone: 'Pacific/Kiritimati',
        unitLabel: 'energy',
        microUsdPerUnit: 100_000,
        slotsNewGame: 1,
        slotsEdit: 3,
        hardCapMultiplier: 1,
      })
      .run();
    insertJob(deps, { id: QUEUED });
    reserve({ db: deps.db, jobId: QUEUED, at: NOW, zone: 'Pacific/Kiritimati', amountMicroUsd: 2_000_000 });
    const snapshot = energySource({ db: deps.db, zone: ZONE }).snapshot(NOW);
    expect(snapshot.usage).toMatchObject({ day: 2_000_000, week: 5_000_000, month: 2_000_000 });
  });

  it('does not count last month in this month', () => {
    const snapshot = energySource({ db: worked().db, zone: ZONE }).snapshot(new Date('2026-11-01T20:00:00Z'));
    expect(snapshot.usage).toMatchObject({ day: 0, week: 3_000_000, month: 0 });
  });
});

describe('energy level', () => {
  const level = (limits: Partial<EnergyLimits>) => {
    const deps = worked();
    writeLimits(deps.db, { ...NONE, ...limits }, NOW);
    return energyLevel(energySource({ db: deps.db, zone: ZONE }).snapshot(NOW));
  };

  it('is unknown with no limit set, never healthy by default', () => expect(level({})).toBe('unknown'));
  it('is unknown when the only cap is on a service Game Maker does not meter', () =>
    expect(level({ voice: 1_000_000 })).toBe('unknown'));
  it('is healthy with room in every window', () => expect(level({ day: 10_000_000 })).toBe('healthy'));
  it('follows the tightest overlapping window', () =>
    expect(level({ day: 10_000_000, month: 3_500_000 })).toBe('limited'));
  it('is critical once a window is spent', () => expect(level({ week: 3_000_000 })).toBe('critical'));
});

describe('energy routes', () => {
  it('shows a player percentages and status without dollars or providers', async () => {
    const deps = worked();
    writeLimits(deps.db, { ...NONE, day: 4_000_000 }, NOW);
    const { app } = await makeApp(deps);
    const response = await app.request('/api/v1/energy', { headers: asUser(ids.creator) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(EnergyView.parse(body)).toEqual(body);
    expect(body).toEqual({
      level: 'healthy',
      preference: 'balanced',
      windows: [
        { window: 'day', usedPercent: 75, resetsAt: RESETS_AT },
        { window: 'week', usedPercent: null, resetsAt: '2026-11-02T08:00:00.000Z' },
        { window: 'month', usedPercent: null, resetsAt: RESETS_AT },
      ],
      services: [
        { service: 'voice', usedPercent: null },
        { service: 'images', usedPercent: null },
      ],
    });
  });

  it('keeps each player their own preference', async () => {
    const { app } = await makeApp(worked());
    const saved = await app.request('/api/v1/energy/preference', {
      method: 'PUT',
      ...json(ids.creator, { preference: 'save' }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ preference: 'save' });
    const mine = await (await app.request('/api/v1/energy', { headers: asUser(ids.creator) })).json();
    const theirs = await (await app.request('/api/v1/energy', { headers: asUser(ids.other) })).json();
    expect([mine.preference, theirs.preference]).toEqual(['save', 'balanced']);
    const bad = await app.request('/api/v1/energy/preference', {
      method: 'PUT',
      ...json(ids.creator, { preference: 'max' }),
    });
    expect(bad.status).toBe(400);
  });

  it('shows costs and sets limits for a platform admin only', async () => {
    const { app } = await makeApp(worked());
    // A family owner is not an instance admin: the pool is shared by every family.
    expect((await app.request('/api/v1/energy/admin', { headers: asUser(ids.creator) })).status).toBe(403);
    const limits = { ...NONE, week: 6_000_000, images: 2_000_000 };
    const denied = await app.request('/api/v1/energy/admin/limits', { method: 'PUT', ...json(ids.creator, limits) });
    expect(denied.status).toBe(403);

    const set = await app.request('/api/v1/energy/admin/limits', { method: 'PUT', ...json(ids.admin, limits) });
    expect(set.status).toBe(200);
    const view = EnergyAdminView.parse(await set.json());
    expect(view).toMatchObject({ limits, usage: { week: 3_000_000, images: null }, level: 'healthy' });
    const player = await (await app.request('/api/v1/energy', { headers: asUser(ids.creator) })).json();
    expect(player.windows[1]).toMatchObject({ window: 'week', usedPercent: 50 });
  });
});

describe('admission against Energy', () => {
  const request = (overrides: Partial<CreateJobRequest> = {}): CreateJobRequest => ({
    gameId: ids.game,
    branchId: 'main',
    kind: 'feature',
    complexity: 1,
    plan,
    start: 'now',
    ...overrides,
  });
  const actor = {
    userId: ids.creator,
    familyId: ids.family,
    platformRole: 'none' as const,
    capability: 'creator' as const,
  };

  function run(limits: Partial<EnergyLimits>, overrides: Partial<CreateJobRequest> = {}, dailyMicroUsd = 1e9) {
    const deps = worked();
    // Room in the member allowance and family cap by default, so only Energy can refuse.
    deps.db.insert(schema.allowances).values({ familyId: ids.family, userId: ids.creator, dailyMicroUsd }).run();
    writeLimits(deps.db, { ...NONE, ...limits }, NOW);
    return admit(
      {
        db: deps.db,
        sqlite: deps.sqlite,
        events: deps.events,
        now: () => NOW,
        defaults: { dailyAllowanceMicroUsd: 1e9, resetZone: ZONE },
      },
      request(overrides),
      actor,
    );
  }

  it('admits a build that fits every window', async () => {
    await expect(run({ day: 1e9, week: 1e9, month: 1e9 })).resolves.toMatchObject({ state: 'admitted' });
  });

  it('names the week a build does not fit, without dollars, and offers no queue since tomorrow is the same week', async () => {
    await expect(run({ day: 1e9, week: 3_100_000 })).rejects.toMatchObject({
      body: {
        error: 'energy_limit_reached',
        window: 'week',
        // Players never see dollars; the instance's headroom stays with admins.
        remainingMicroUsd: 0,
        resetsAt: '2026-11-02T08:00:00.000Z',
        offers: ['ask_admin'],
      },
    });
  });

  it('offers the queue when only today is spent', async () => {
    await expect(run({ day: 3_000_000 })).rejects.toMatchObject({
      body: { error: 'energy_limit_reached', window: 'day', offers: ['queue', 'ask_admin'] },
    });
    await expect(run({ day: 3_000_000 }, { start: 'at_reset' })).resolves.toMatchObject({ state: 'queued' });
  });

  it('offers the queue on the last day of the month, since the build fits once the month resets', async () => {
    await expect(run({ month: 3_100_000 })).rejects.toMatchObject({
      body: { error: 'energy_limit_reached', window: 'month', resetsAt: RESETS_AT, offers: ['queue', 'ask_admin'] },
    });
  });

  it('refuses a build queued for the reset when that day is still in a spent week', async () => {
    await expect(run({ week: 3_000_000 }, { start: 'at_reset' })).rejects.toMatchObject({
      body: { error: 'energy_limit_reached', window: 'week', offers: ['ask_admin'] },
    });
  });

  it("keeps the member's own allowance refusal ahead of Energy", async () => {
    await expect(run({ day: 0 }, {}, 3_000_000)).rejects.toMatchObject({ body: { error: 'allowance_exceeded' } });
  });
});
