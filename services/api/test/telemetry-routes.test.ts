import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { BATCHES_PER_USER_PER_HOUR, MAX_BODY_BYTES } from '../src/telemetry/routes.js';
import { pruneEvents, topFrame } from '../src/telemetry/store.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const kevin: TestUser = {
  kind: 'user',
  userId: 'u-kevin',
  displayName: 'Kevin',
  email: 'kevin@example.test',
  familyId: 'f-telemetry',
  platformRole: 'admin',
  capability: 'creator',
};

const sessionId = randomUUID();
const base = {
  at: '2026-11-24T02:35:00.000Z',
  sessionId,
  origin: 'https://gm.example',
  appVersion: 'abc1234',
  device: 'iPhone Safari',
};

function crash(overrides: Record<string, unknown> = {}) {
  return {
    ...base,
    kind: 'crash',
    crash: 'game_error',
    step: 'in-world',
    gameId: 'g_5b1f0d3e-8c1a-4c55-9a39-2f8f3c1d7e40',
    buildId: 'b-1',
    message: 'TypeError: cannot read properties of undefined (reading 17)',
    stack:
      'TypeError\n    at tick (https://games.example/g/g_5b1f0d3e-8c1a-4c55-9a39-2f8f3c1d7e40/b-1/systems/helm.js:40:12)',
    breadcrumbs: ['route /games/g_5b1f0d3e-8c1a-4c55-9a39-2f8f3c1d7e40', 'bridge ready', 'first frame'],
    ...overrides,
  };
}

async function setup() {
  const deps = makeDeps();
  installUsers(deps, [kevin]);
  const { app } = await makeApp(deps);
  const post = (events: unknown[], headers: Record<string, string> = asUser(kevin.userId)) =>
    app.request('/api/v1/telemetry/client-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ events }),
    });
  const groups = () =>
    deps.sqlite
      .prepare('SELECT game_id, build_id, signature, crash, count FROM crash_groups ORDER BY build_id')
      .all() as { game_id: string; build_id: string; signature: string; crash: string; count: number }[];
  return { deps, post, groups };
}

describe('POST /api/v1/telemetry/client-events', () => {
  it('groups repeats of one crash so the listener raises it once, counting every hit', async () => {
    const { post, groups } = await setup();
    expect((await post([crash()])).status).toBe(202);
    // Same failure, different volatile numbers in the message and stack position: still the same crash.
    expect(
      (await post([crash({ message: 'TypeError: cannot read properties of undefined (reading 99)' })])).status,
    ).toBe(202);
    expect(groups()).toEqual([
      expect.objectContaining({ game_id: 'g_5b1f0d3e-8c1a-4c55-9a39-2f8f3c1d7e40', build_id: 'b-1', count: 2 }),
    ]);
  });

  it('gives a new build its own group but the same signature, so a known crash is recognised after a publish', async () => {
    const { post, groups } = await setup();
    await post([crash(), crash({ buildId: 'b-2', stack: crash().stack.replaceAll('b-1', 'b-2') })]);
    const [first, second] = groups();
    expect([first.build_id, second.build_id]).toEqual(['b-1', 'b-2']);
    expect(second.signature).toBe(first.signature);
  });

  it('keeps different failures apart', async () => {
    const { post, groups } = await setup();
    await post([crash(), crash({ crash: 'csp_violation', message: 'script-src blocked https://cdn.example/x.js' })]);
    expect(new Set(groups().map((group) => group.signature)).size).toBe(2);
  });

  it('records app opens and play heartbeats without creating crash groups', async () => {
    const { deps, post, groups } = await setup();
    const response = await post([
      { ...base, kind: 'app_open', resumed: false },
      { ...base, kind: 'first_frame', gameId: 'g_5b1f0d3e-8c1a-4c55-9a39-2f8f3c1d7e40', buildId: 'b-1' },
      { ...base, kind: 'in_world', gameId: 'g_5b1f0d3e-8c1a-4c55-9a39-2f8f3c1d7e40', buildId: 'b-1' },
      { ...base, kind: 'session_end', reason: 'hidden' },
    ]);
    expect(response.status).toBe(202);
    const kinds = deps.sqlite.prepare('SELECT kind, user_id FROM client_events ORDER BY id').all();
    expect(kinds).toEqual([
      { kind: 'app_open', user_id: kevin.userId },
      { kind: 'first_frame', user_id: kevin.userId },
      { kind: 'in_world', user_id: kevin.userId },
      { kind: 'session_end', user_id: kevin.userId },
    ]);
    expect(groups()).toEqual([]);
  });

  it('accepts only signed-in family members', async () => {
    const { post } = await setup();
    expect((await post([crash()], {})).status).toBe(401);
  });

  it('rejects unknown fields so free text cannot ride along', async () => {
    const { post } = await setup();
    expect((await post([{ ...crash(), email: 'kevin@example.test' }])).status).toBe(400);
  });

  it('bounds the body and the rate a single account can send', async () => {
    const { post } = await setup();
    const huge = Array.from({ length: 20 }, () => crash({ stack: 'x'.repeat(4000) }));
    expect(JSON.stringify({ events: huge }).length).toBeGreaterThan(MAX_BODY_BYTES);
    expect((await post(huge)).status).toBe(413);

    for (let index = 1; index < BATCHES_PER_USER_PER_HOUR; index += 1) await post([{ ...base, kind: 'first_frame' }]);
    expect((await post([crash()])).status).toBe(429);
  });
});

describe('telemetry store', () => {
  it('reads the top frame without origin, build path or position', () => {
    expect(topFrame(crash().stack)).toBe('systems/helm.js');
    expect(topFrame(undefined)).toBe('');
  });

  it('prunes raw events after 30 days but keeps crash group counts', async () => {
    const { deps, post, groups } = await setup();
    expect((await post([crash()])).status).toBe(202);
    expect(pruneEvents(deps.sqlite, new Date(Date.now() + 31 * 24 * 60 * 60 * 1000))).toBe(1);
    expect(groups()).toEqual([expect.objectContaining({ count: 1 })]);
  });
});
