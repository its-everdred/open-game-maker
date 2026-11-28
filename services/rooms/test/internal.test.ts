import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LIMITS } from '@ogm/contracts';

import { INTERNAL_SECRET, connect, type Harness, startHarness } from './helpers.js';

describe('rooms internal API', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.testServer.cleanup();
  });

  afterAll(async () => {
    await harness.testServer.shutdown();
  });

  function createRoom(body: Record<string, unknown>, token = INTERNAL_SECRET) {
    return harness.app.request('/internal/rooms', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function revokeRoom(roomId: string, body: Record<string, unknown>) {
    return harness.app.request(`/internal/rooms/${roomId}/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${INTERNAL_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects missing and wrong bearer tokens with an empty body', async () => {
    const missing = await harness.app.request('/internal/rooms', { method: 'POST' });
    const wrong = await createRoom({}, 'short');

    expect(missing.status).toBe(401);
    expect(await missing.text()).toBe('');
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toBe('');
  });

  it('creates a pinned room and clamps maxPlayers', async () => {
    const response = await createRoom({
      gameId: 'g_01J',
      branchId: 'main',
      buildId: 'sha256:ab12',
      ownerId: 'u_01J',
      maxPlayers: 12,
    });

    expect(response.status).toBe(201);
    const { roomId } = (await response.json()) as { roomId: string };
    const room = harness.testServer.getRoomById(roomId);
    expect(room.state.pin.toJSON()).toEqual({ gameId: 'g_01J', branchId: 'main', buildId: 'sha256:ab12' });
    expect(room.state.maxPlayers).toBe(LIMITS.maxPlayersCeiling);
  });

  it('returns health counts and 404 for a missing revoke target', async () => {
    const health = await harness.app.request('/healthz');
    const revoke = await revokeRoom('missing', { userId: 'nobody' });

    expect(await health.json()).toMatchObject({ ok: true, service: 'rooms', version: 'test-version', rooms: 0 });
    expect(revoke.status).toBe(404);
  });

  it('revokes a connected room member through the internal route', async () => {
    const created = await createRoom({
      gameId: 'g_test',
      branchId: 'main',
      buildId: 'sha256:one',
      ownerId: 'owner',
      maxPlayers: 4,
    });
    const { roomId } = (await created.json()) as { roomId: string };
    const room = harness.testServer.getRoomById(roomId);
    if (room === undefined) throw new Error('created room not found');
    const player = await connect(harness.testServer, room, 'player', 'player');
    const ended = player.waitForMessage('ended');

    const response = await revokeRoom(roomId, { userId: 'player' });

    expect(response.status).toBe(204);
    expect(await ended).toEqual({ reason: 'revoked' });
  });

  it('invalidates a connected user through the internal route and fails on a missing room', async () => {
    const created = await createRoom({
      gameId: 'g_test',
      branchId: 'main',
      buildId: 'sha256:one',
      ownerId: 'owner',
      maxPlayers: 4,
    });
    const { roomId } = (await created.json()) as { roomId: string };
    const room = harness.testServer.getRoomById(roomId);
    const player = await connect(harness.testServer, room, 'player', 'player');
    const ended = player.waitForMessage('ended');
    const request = (id: string) =>
      harness.app.request(`/internal/rooms/${id}/invalidate-user`, {
        method: 'POST',
        headers: { authorization: `Bearer ${INTERNAL_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'player' }),
      });
    expect((await request(roomId)).status).toBe(204);
    expect(await ended).toEqual({ reason: 'revoked' });
    expect((await request('missing')).status).toBe(503);
  });
});
