import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnergyAdminView } from '@ogm/contracts';
import { schema } from '@ogm/db';

import { aiurReadings, elevenLabsReading, type ProviderReading } from '../../src/energy/providers.js';
import { readHistory, recordSamples } from '../../src/energy/samples.js';
import { energySource } from '../../src/energy/source.js';
import { adminView } from '../../src/energy/view.js';
import { asUser, makeApp } from '../helpers.js';
import { ids, NOW, worked, ZONE } from '../budget/fixture.js';

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
afterEach(() => vi.useRealTimers());

const window = (freshness: string, used: number, resets: string) => ({
  kind: 'rate_limit',
  name: 'Weekly',
  freshness,
  observed_at: '2026-10-31T19:58:00Z',
  resets_at: resets,
  used_percent: used,
});
const usage = (provider: string, freshness: string, windows: Record<string, unknown>) => ({
  contract: 'aiur.usage',
  contract_version: 1,
  provider: { provider, freshness, observed_at: '2026-10-31T19:58:00Z', fields: { windows } },
});
// Claude fresh at 53 %, Codex stale at 97 % (the 2026-11-22 NUC readings), OpenRouter with no reading, ElevenLabs
// with a quarter of its characters used, and fal at 1.80 of its 9 USD stop.
const readings = (): ProviderReading[] => [
  ...aiurReadings(
    'claude',
    'Claude',
    usage('claude', 'fresh', { seven_day: window('fresh', 53, '2026-11-05T09:00Z') }),
  ),
  ...aiurReadings('codex', 'Codex', usage('codex', 'stale', { 'codex:primary': window('stale', 97, '2026-11-04Z') })),
  ...aiurReadings('openrouter', 'OpenRouter', {
    contract: 'aiur.usage',
    provider: { provider: 'openrouter', freshness: 'unknown', observed_at: null, fields: {} },
  }),
  {
    id: 'fal',
    label: 'fal',
    provider: 'fal',
    kind: 'metered_spend',
    usedPercent: 20,
    resetsAt: null,
    observedAt: NOW.toISOString(),
    stale: false,
    basis: 'estimate',
    spentMicroUsd: 1_800_000,
    capMicroUsd: 9_000_000,
  },
  {
    ...elevenLabsReading({ character_count: 25_000, character_limit: 100_000 }, NOW.toISOString()),
    service: 'voice',
  },
];

const view = (deps = worked(), netlifyLog: string | null = null) =>
  adminView(energySource({ db: deps.db, zone: ZONE, readings: readings(), netlifyLog }).snapshot(NOW), 'balanced');
const byId = (admin: EnergyAdminView, id: string) => admin.resources.find((resource) => resource.id === id);

describe('Energy admin resources', () => {
  it('lists one row per provider window, balance, quota and cap, each with its unit and basis', () => {
    const admin = EnergyAdminView.parse(view());
    expect(admin.resources.map(({ id, kind, unit, basis }) => [id, kind, unit, basis])).toEqual([
      ['instance/day', 'cap', 'usd', 'estimate'],
      ['instance/week', 'cap', 'usd', 'estimate'],
      ['instance/month', 'cap', 'usd', 'estimate'],
      ['claude/seven_day', 'subscription_window', 'percent', 'reported'],
      ['codex/primary', 'subscription_window', 'percent', 'unknown'],
      ['openrouter/balance', 'prepaid_balance', 'usd', 'unknown'],
      ['fal/ledger', 'metered_spend', 'usd', 'estimate'],
      ['fal/balance', 'prepaid_balance', 'usd', 'unknown'],
      ['elevenlabs/characters', 'quota', 'characters', 'reported'],
      ['netlify/credits', 'quota', 'credits', 'unknown'],
    ]);
    expect(byId(admin, 'claude/seven_day')).toMatchObject({ used: 53, limit: 100, left: 47, state: 'available' });
    expect(byId(admin, 'elevenlabs/characters')).toMatchObject({ used: 25_000, limit: 100_000, left: 75_000 });
    expect(byId(admin, 'fal/ledger')).toMatchObject({ used: 1.8, limit: 9, left: 7.2, origin: 'ogm.ledger' });
  });

  // A stale 97 % or an unread balance is not 0 left or 100 left: it has no figure, keeps its age and binds nothing.
  it('never turns an unknown or stale figure into 0 or 100', () => {
    const admin = view();
    for (const id of ['codex/primary', 'openrouter/balance', 'fal/balance', 'netlify/credits']) {
      expect(byId(admin, id)).toMatchObject({ used: null, left: null, state: 'unknown' });
    }
    expect(byId(admin, 'codex/primary')).toMatchObject({ freshness: 'stale', ageMs: 120_000 });
    expect(admin.pool.binding).toMatchObject({ id: 'claude/seven_day', leftPercent: 47, freshness: 'fresh' });
  });

  it('records unknown and stale history as gaps, not as empty or full', () => {
    const deps = worked();
    const admin = view(deps);
    recordSamples(deps.db, admin.resources, NOW);
    const history = readHistory(deps.db, NOW);
    expect(history.find(({ id }) => id === 'codex/primary')?.points).toEqual([
      { at: NOW.toISOString(), left: null, low: null, high: null, basis: 'unknown' },
    ]);
    expect(history.find(({ id }) => id === 'claude/seven_day')?.points[0]).toMatchObject({ left: 47 });
  });

  it('labels nothing as billed', () => {
    expect(JSON.stringify(view())).not.toMatch(/billed/i);
  });

  it('counts Netlify production deploys at 15 credits each against the entered allotment', () => {
    const deps = worked();
    const log = join(mkdtempSync(join(tmpdir(), 'ogm-netlify-')), 'deploys.log');
    // Two deploys this month (October, Los Angeles) and one in September, which no longer counts.
    writeFileSync(log, '2026-09-30T20:00:00Z\n2026-10-02T20:00:00Z\n2026-10-30T20:00:00Z\n');
    deps.db.insert(schema.energyCaps).values({ id: 'netlify/credits', limit: 300, updatedAt: NOW.toISOString() }).run();
    expect(byId(view(deps, log), 'netlify/credits')).toMatchObject({
      used: 30,
      limit: 300,
      left: 270,
      basis: 'estimate',
      editable: true,
    });
    expect(byId(view(deps, join(log, 'missing')), 'netlify/credits')).toMatchObject({ used: null, basis: 'unknown' });
  });

  // D5: $200 a month is $46.15 a week (12/52 of a month), not $50; the used share is a range, never one figure.
  it('turns a plan fee into a weekly estimate with a used range from the fresh weekly window', () => {
    const deps = worked();
    for (const [id, limit] of [
      ['claude/plan', 200],
      ['codex/plan', 200],
    ] as const) {
      deps.db.insert(schema.energyCaps).values({ id, limit, updatedAt: NOW.toISOString() }).run();
    }
    expect(view(deps).subscriptions).toEqual([
      {
        id: 'claude/plan',
        label: 'Claude',
        planUsdPerMonth: 200,
        weeklyUsd: 46.15,
        usedUsd: { low: 22.01, high: 26.91 },
        basis: 'estimate',
      },
      // Codex is stale, so its used share is unknown rather than 97 % of the budget.
      {
        id: 'codex/plan',
        label: 'Codex',
        planUsdPerMonth: 200,
        weeklyUsd: 46.15,
        usedUsd: null,
        basis: 'estimate',
      },
    ]);
  });
});

describe('Energy admin history', () => {
  it('samples at most once a minute, keeps 30 days and returns the last sample of each hour', () => {
    const deps = worked();
    const resources = view(deps).resources.filter(({ id }) => id === 'claude/seven_day');
    const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
    recordSamples(deps.db, resources, at(-31 * 86_400_000));
    recordSamples(deps.db, resources, at(-30_000));
    recordSamples(deps.db, [{ ...resources[0]!, used: 99, left: 1 }], at(0));
    recordSamples(deps.db, [{ ...resources[0]!, used: 55, left: 45 }], at(2 * 60_000));
    recordSamples(deps.db, [{ ...resources[0]!, used: 60, left: 40 }], at(10 * 60_000));
    // The 31-day-old row is gone, the sample 30 s after another was skipped, and 20:02 gave way to 20:10.
    const points = readHistory(deps.db, at(10 * 60_000))[0]!.points;
    expect(points.map(({ at, left }) => [at, left])).toEqual([
      [at(-30_000).toISOString(), 47],
      [at(10 * 60_000).toISOString(), 40],
    ]);
    expect(deps.db.select().from(schema.energySamples).all()).toHaveLength(3);
  });
});

describe('Energy admin routes', () => {
  it('refuses a non-admin the dashboard and its caps', async () => {
    const { app } = await makeApp(worked());
    const put = (as: string, body: unknown) =>
      app.request('/api/v1/energy/admin/caps', {
        method: 'PUT',
        headers: { ...asUser(as), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await app.request('/api/v1/energy/admin', { headers: asUser(ids.creator) })).status).toBe(403);
    expect((await put(ids.creator, { 'netlify/credits': 300 })).status).toBe(403);
    const saved = await put(ids.admin, { 'netlify/credits': 300, 'claude/plan': 200 });
    expect(saved.status).toBe(200);
    const admin = EnergyAdminView.parse(await saved.json());
    expect(admin.caps.find(({ id }) => id === 'netlify/credits')).toMatchObject({ limit: 300, editable: true });
    expect(admin.subscriptions.map(({ id }) => id)).toEqual(['claude/plan']);
  });

  // aiur owns its windows and caps: the dashboard shows them read-only and the API refuses to set them.
  it('does not let an admin edit an aiur cap or provider window', async () => {
    const deps = worked();
    deps.registry.energyReadings = { read: async () => readings() };
    const { app } = await makeApp(deps);
    for (const body of [{ 'claude/seven_day': 50 }, { 'openrouter/balance': 10 }, { 'fal/stop': 20 }]) {
      const refused = await app.request('/api/v1/energy/admin/caps', {
        method: 'PUT',
        headers: { ...asUser(ids.admin), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(refused.status).toBe(400);
    }
    expect(deps.db.select().from(schema.energyCaps).all()).toEqual([]);
    const admin = EnergyAdminView.parse(
      await (await app.request('/api/v1/energy/admin', { headers: asUser(ids.admin) })).json(),
    );
    for (const resource of admin.resources.filter(({ origin }) => origin.startsWith('aiur'))) {
      expect(resource.editable, resource.id).toBe(false);
    }
    expect(admin.caps.filter(({ editable }) => editable).map(({ id }) => id)).toEqual([
      'netlify/credits',
      'claude/plan',
      'codex/plan',
    ]);
  });
});
