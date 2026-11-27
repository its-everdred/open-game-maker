import { savesPath } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T16:00:00.000Z';
const ids = {
  family: 'f_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  game: 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  user: 'u_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  device: 'device_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  otherDevice: 'device_01BX5ZZKBKACTAV9WEVGEMMVRZ',
  tab: 'tab_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  branch: 'b_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  build: 'build_01ARZ3NDEKTSV4RRFFQ69G5FAV',
} as const;

const user: TestUser = {
  kind: 'user',
  userId: ids.user,
  email: 'player@example.test',
  familyId: ids.family,
  platformRole: 'none',
  capability: 'player',
};

async function setup() {
  const deps = makeDeps();
  installUsers(deps, [user]);
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.user, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: ids.family, userId: ids.user, role: 'owner', capability: 'player', joinedAt: now })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.user,
      title: 'Save routes',
      visibility: 'listed',
      publishedReleaseId: 'release_fixture',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  return makeApp(deps);
}

const jsonHeaders = { ...asUser(ids.user), 'content-type': 'application/json' };
const base = `/api/v1${savesPath(ids.game)}`;

async function lease(app: Awaited<ReturnType<typeof makeApp>>['app'], deviceId = ids.device, takeover = false) {
  return app.request(`${base}/lease`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ deviceId, tabId: ids.tab, takeover }),
  });
}

function saveHeaders(sequence: number, ifMatch: number, deviceId = ids.device): Record<string, string> {
  return {
    ...asUser(ids.user),
    'content-type': 'application/octet-stream',
    'content-encoding': 'gzip',
    'if-match': String(ifMatch),
    'idempotency-key': `${deviceId}:${sequence}`,
    'x-save-schema': '3',
    'x-save-branch': ids.branch,
    'x-save-build': ids.build,
    'x-save-reason': 'interval',
  };
}

describe('save routes', () => {
  it('writes, replays, reports stale heads, and streams an opaque revision', async () => {
    const { app, deps } = await setup();
    expect((await lease(app)).status).toBe(200);
    const payload = new TextEncoder().encode('gzip-json-payload');
    const created = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: saveHeaders(42, 0),
      body: payload,
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ revision: 1 });

    const otherDevice = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: saveHeaders(1, 1, ids.otherDevice),
      body: payload,
    });
    expect(otherDevice.status).toBe(423);
    expect(await otherDevice.json()).toEqual({ heldBy: ids.device });

    const replayed = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: saveHeaders(42, 0),
      body: payload,
    });
    expect(await replayed.json()).toEqual({ revision: 1 });
    expect(deps.sqlite.prepare('SELECT COUNT(*) AS count FROM save_revisions').get()).toEqual({ count: 1 });

    const stale = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: saveHeaders(43, 0),
      body: payload,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ headRevision: 1 });

    const loaded = await app.request(`${base}/auto`, { headers: asUser(ids.user) });
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get('x-save-revision')).toBe('1');
    expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(payload);
  });

  it('requires the play lease, enforces the compressed limit, and derives list status', async () => {
    const { app } = await setup();
    const noLease = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: saveHeaders(1, 0),
      body: new Uint8Array([1]),
    });
    expect(noLease.status).toBe(423);
    expect(await noLease.json()).toEqual({ heldBy: null });

    await lease(app);
    const tooLarge = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: saveHeaders(1, 0),
      body: new Uint8Array(513 * 1024),
    });
    expect(tooLarge.status).toBe(413);

    const created = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: saveHeaders(1, 0),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(created.status).toBe(200);
    const listed = await app.request(`${base}?schema=4&migratesFrom=3`, { headers: asUser(ids.user) });
    expect(await listed.json()).toEqual({
      slots: [expect.objectContaining({ slotId: 'auto', headRevision: 1, status: 'needs_migration' })],
    });
  });

  it('rejects integer headers outside the safe JavaScript range', async () => {
    const { app } = await setup();
    await lease(app);
    const response = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: { ...saveHeaders(1, 0), 'idempotency-key': `${ids.device}:9007199254740992` },
      body: new Uint8Array([1, 2, 3]),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'invalid_save',
      details: { header: 'idempotency-key' },
    });
  });

  it('requires explicit lease takeover and returns the previous holder', async () => {
    const { app } = await setup();
    expect((await lease(app)).status).toBe(200);
    const heartbeat = await app.request(`${base}/lease/heartbeat`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ deviceId: ids.device, tabId: ids.tab }),
    });
    expect(heartbeat.status).toBe(200);
    const held = await lease(app, ids.otherDevice);
    expect(held.status).toBe(409);
    expect(await held.json()).toEqual({ heldBy: ids.device });
    const takeover = await lease(app, ids.otherDevice, true);
    expect(takeover.status).toBe(200);
    expect(await takeover.json()).toEqual({ expiresAt: expect.any(String), previousHolder: ids.device });
    const staleWrite = await app.request(`${base}/auto`, {
      method: 'PUT',
      headers: saveHeaders(1, 0),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(staleWrite.status).toBe(423);
    expect(await staleWrite.json()).toEqual({ heldBy: ids.otherDevice });
    const staleHeartbeat = await app.request(`${base}/lease/heartbeat`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ deviceId: ids.device, tabId: ids.tab }),
    });
    expect(staleHeartbeat.status).toBe(423);
    expect(await staleHeartbeat.json()).toEqual({ heldBy: ids.otherDevice });
  });

  it('keeps the pre-#281 /saves/:gameId path as an alias of the game-scoped saves', async () => {
    const { app } = await setup();
    const legacy = `/api/v1/saves/${ids.game}`;
    expect(base).toBe(`/api/v1/games/${ids.game}/saves`);
    expect((await lease(app)).status).toBe(200);
    const payload = new Uint8Array([7, 8, 9]);
    const written = await app.request(`${legacy}/1`, { method: 'PUT', headers: saveHeaders(1, 0), body: payload });
    expect(written.status).toBe(200);

    const loaded = await app.request(`${base}/1`, { headers: asUser(ids.user) });
    expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(payload);
    const listed = await app.request(`${legacy}?schema=3`, { headers: asUser(ids.user) });
    expect(await listed.json()).toEqual({ slots: [expect.objectContaining({ slotId: '1', headRevision: 1 })] });
  });
});
