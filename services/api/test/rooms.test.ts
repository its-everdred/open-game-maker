import { schema } from '@ogm/db';
import { verifyGrant } from '@ogm/room-protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  createRoom,
  createRoomInvitation,
  freshRoomGrant,
  joinRoom,
  recordRoomEnded,
  revokeRoomAccess,
} from '../src/rooms/rooms.js';
import { hashOf } from '../src/invites/tokens.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T00:00:00.000Z';
const nowMs = Date.parse(now);
const familyId = 'f-family';
const owner: TestUser = {
  kind: 'user',
  userId: 'u-owner',
  email: 'owner@example.com',
  displayName: 'Owner',
  familyId,
  platformRole: 'none',
  capability: 'creator',
};
const member: TestUser = {
  kind: 'user',
  userId: 'u-member',
  email: 'member@example.com',
  displayName: 'Member',
  familyId,
  platformRole: 'none',
  capability: 'player',
};
const other: TestUser = {
  kind: 'user',
  userId: 'u-other',
  email: 'other@example.com',
  displayName: 'Other',
  familyId,
  platformRole: 'none',
  capability: 'player',
};
const friend: TestUser = {
  kind: 'user',
  userId: 'u-friend',
  email: 'friend@example.com',
  displayName: 'Friend',
  familyId: 'f-friend',
  platformRole: 'none',
  capability: 'player',
};

function setup() {
  const deps = makeDeps();
  installUsers(deps, [owner, member, other, friend]);
  deps.db
    .insert(schema.families)
    .values({ id: familyId, name: 'Household', ownerUserId: owner.userId, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId, userId: owner.userId, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId, userId: member.userId, role: 'member', capability: 'player', joinedAt: now },
      { familyId, userId: other.userId, role: 'member', capability: 'player', joinedAt: now },
    ])
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: 'g-1',
      familyId,
      ownerId: owner.userId,
      title: 'Castle Game',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  return deps;
}

function createdRoomResponse(roomId = 'room-1') {
  return new Response(JSON.stringify({ roomId }), { status: 201, headers: { 'content-type': 'application/json' } });
}

describe('room lifecycle service', () => {
  it('creates one clamped room, persists it only after the relay succeeds, and signs an owner grant', async () => {
    const deps = setup();
    const relay = vi.fn<typeof fetch>().mockResolvedValue(createdRoomResponse());

    const created = await createRoom(
      deps,
      owner,
      { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1', maxPlayers: 99 },
      nowMs,
      relay,
    );

    expect(created).toMatchObject({
      roomId: 'room-1',
      pin: { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1' },
      roomsUrl: 'https://api.example.test:8443/ws/rooms',
    });
    expect(await verifyGrant(created.grant, deps.config.roomGrantSecret, nowMs)).toMatchObject({
      ok: true,
      grant: {
        sub: owner.userId,
        roomId: 'room-1',
        role: 'owner',
        name: 'Owner',
        iat: Math.floor(nowMs / 1000),
        exp: Math.floor(nowMs / 1000) + 600,
      },
    });
    expect(await relay.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1', ownerId: owner.userId, maxPlayers: 8 }),
    );
    expect(deps.db.select().from(schema.rooms).get()).toMatchObject({ id: 'room-1', maxPlayers: 8 });

    const reused = await createRoom(
      deps,
      owner,
      { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1' },
      nowMs,
      relay,
    );
    expect(reused.roomId).toBe('room-1');
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it('rejects non-owner creation before contacting the relay', async () => {
    const deps = setup();
    const relay = vi.fn<typeof fetch>();

    await expect(
      createRoom(deps, member, { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1' }, nowMs, relay),
    ).rejects.toMatchObject({ status: 403, code: 'not_owner' });
    expect(relay).not.toHaveBeenCalled();
  });

  it('coalesces concurrent creation for the same game branch', async () => {
    const deps = setup();
    let release: ((response: Response) => void) | undefined;
    const relay = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    const first = createRoom(deps, owner, { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1' }, nowMs, relay);
    const second = createRoom(deps, owner, { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1' }, nowMs, relay);
    await vi.waitFor(() => expect(relay).toHaveBeenCalledTimes(1));
    release?.(createdRoomResponse());

    await expect(Promise.all([first, second])).resolves.toMatchObject([{ roomId: 'room-1' }, { roomId: 'room-1' }]);
    expect(deps.db.select().from(schema.rooms).all()).toHaveLength(1);
  });

  it('maps the two-second rooms-service abort to an unavailable response', async () => {
    const deps = setup();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const relay = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    try {
      const creation = createRoom(
        deps,
        owner,
        { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1' },
        nowMs,
        relay,
      );
      await vi.waitFor(() => expect(relay).toHaveBeenCalledOnce());
      controller.abort();

      await expect(creation).rejects.toMatchObject({ status: 503, code: 'rooms_unavailable' });
      expect(timeout).toHaveBeenCalledWith(2_000);
      expect(relay).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
    } finally {
      timeout.mockRestore();
    }
  });

  it('does not persist a room when the relay is unavailable', async () => {
    const deps = setup();
    const relay = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      createRoom(deps, owner, { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1' }, nowMs, relay),
    ).rejects.toMatchObject({ status: 503, code: 'rooms_unavailable' });
    expect(deps.db.select().from(schema.rooms).all()).toEqual([]);
  });

  it('creates a seven-day hashed link and joins the same signed-in user idempotently', async () => {
    const deps = setup();
    deps.db
      .insert(schema.rooms)
      .values({
        id: 'room-1',
        gameId: 'g-1',
        branchId: 'branch-1',
        buildId: 'build-1',
        ownerId: owner.userId,
        maxPlayers: 4,
        createdAt: now,
      })
      .run();

    const invitation = await createRoomInvitation(deps, owner, 'room-1', { email: member.email }, nowMs);
    const token = invitation.url.split('/').at(-1) ?? '';
    expect(invitation.expiresAt).toBe('2026-11-08T00:00:00.000Z');
    expect(deps.db.select().from(schema.invitations).get()).toMatchObject({
      kind: 'room',
      email: member.email,
      tokenHash: hashOf(token),
    });
    expect(JSON.stringify(deps.db.select().from(schema.invitations).get())).not.toContain(token);

    deps.db.update(schema.games).set({ releaseState: 'coming_soon' }).run();
    await expect(joinRoom(deps, member, token, nowMs)).rejects.toMatchObject({ status: 403, code: 'coming_soon' });
    deps.db.insert(schema.gameEarlyAccess).values({ gameId: 'g-1', userId: member.userId }).run();
    const joined = await joinRoom(deps, member, token, nowMs);
    expect((await verifyGrant(joined.grant, deps.config.roomGrantSecret, nowMs)).ok).toBe(true);
    expect(deps.db.select().from(schema.roomMembers).get()).toMatchObject({
      roomId: 'room-1',
      userId: member.userId,
    });
    await expect(joinRoom(deps, member, token, nowMs)).resolves.toMatchObject({ roomId: 'room-1' });
    await expect(joinRoom(deps, friend, token, nowMs)).rejects.toMatchObject({
      status: 410,
      code: 'invite_gone',
    });
  });

  it('enforces family, bound-email, and ended-room invitation constraints', async () => {
    const deps = setup();
    deps.db
      .insert(schema.rooms)
      .values({
        id: 'room-1',
        gameId: 'g-1',
        branchId: 'branch-1',
        buildId: 'build-1',
        ownerId: owner.userId,
        maxPlayers: 4,
        createdAt: now,
      })
      .run();

    const openInvite = await createRoomInvitation(deps, owner, 'room-1', {}, nowMs);
    await expect(joinRoom(deps, friend, openInvite.url.split('/').at(-1) ?? '', nowMs)).rejects.toMatchObject({
      status: 403,
      code: 'friends_not_allowed',
    });
    deps.db.update(schema.families).set({ friendsAllowed: true }).run();
    await expect(joinRoom(deps, friend, openInvite.url.split('/').at(-1) ?? '', nowMs)).resolves.toMatchObject({
      roomId: 'room-1',
    });

    const boundInvite = await createRoomInvitation(deps, owner, 'room-1', { email: member.email }, nowMs);
    await expect(joinRoom(deps, other, boundInvite.url.split('/').at(-1) ?? '', nowMs)).rejects.toMatchObject({
      status: 403,
      code: 'invite_email_mismatch',
    });

    recordRoomEnded(deps, 'room-1', { reason: 'owner-closed', endedAt: '2026-11-01T00:05:00.000Z' });
    await expect(joinRoom(deps, member, boundInvite.url.split('/').at(-1) ?? '', nowMs)).rejects.toMatchObject({
      status: 410,
      code: 'room_ended',
    });
  });

  it('refreshes grants, revokes access downstream-first, and records room end callbacks idempotently', async () => {
    const deps = setup();
    deps.db
      .insert(schema.rooms)
      .values({
        id: 'room-1',
        gameId: 'g-1',
        branchId: 'branch-1',
        buildId: 'build-1',
        ownerId: owner.userId,
        maxPlayers: 4,
        createdAt: now,
      })
      .run();
    deps.db.insert(schema.roomMembers).values({ roomId: 'room-1', userId: member.userId, joinedAt: now }).run();

    await expect(freshRoomGrant(deps, member, 'room-1', nowMs)).resolves.toMatchObject({ roomId: 'room-1' });
    await expect(freshRoomGrant(deps, other, 'room-1', nowMs)).rejects.toMatchObject({
      status: 403,
      code: 'not_room_member',
    });
    const relay = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await revokeRoomAccess(deps, owner, 'room-1', { userId: member.userId }, nowMs, relay);
    expect(deps.db.select().from(schema.roomMembers).get()?.revokedAt).toBe(now);
    await expect(freshRoomGrant(deps, member, 'room-1', nowMs)).rejects.toMatchObject({
      status: 403,
      code: 'not_room_member',
    });
    expect(relay).toHaveBeenCalledWith(
      'http://127.0.0.1:4302/internal/rooms/room-1/revoke',
      expect.objectContaining({ method: 'POST' }),
    );

    recordRoomEnded(deps, 'room-1', { reason: 'owner-closed', endedAt: '2026-11-01T00:05:00.000Z' });
    recordRoomEnded(deps, 'room-1', { reason: 'idle', endedAt: '2026-11-01T00:06:00.000Z' });
    expect(deps.db.select().from(schema.rooms).get()).toMatchObject({
      endedAt: '2026-11-01T00:05:00.000Z',
      endReason: 'owner-closed',
    });
  });

  it('mounts room creation, direct join, and fresh grant routes', async () => {
    const deps = setup();
    const relay = vi.spyOn(globalThis, 'fetch').mockResolvedValue(createdRoomResponse());

    try {
      const { app } = await makeApp(deps);
      const created = await app.request('/api/v1/games/g-1/rooms', {
        method: 'POST',
        headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
        body: JSON.stringify({ branchId: 'branch-1', buildId: 'build-1', maxPlayers: 4 }),
      });
      expect(created.status).toBe(201);
      expect(created.headers.get('cache-control')).toBe('no-store');
      expect(await created.json()).toMatchObject({
        roomId: 'room-1',
        pin: { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1' },
        grant: expect.any(String),
      });

      const inviteResponse = await app.request('/api/v1/rooms/room-1/invites', {
        method: 'POST',
        headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const invite = (await inviteResponse.json()) as { url: string };
      expect(inviteResponse.headers.get('cache-control')).toBe('no-store');
      const token = invite.url.split('/').at(-1) ?? '';

      const joined = await app.request(`/api/v1/join/${token}`, {
        headers: asUser(member.userId),
      });
      expect(joined.status).toBe(200);
      expect(joined.headers.get('cache-control')).toBe('no-store');
      expect(await joined.json()).toMatchObject({ roomId: 'room-1', grant: expect.any(String) });

      const refreshed = await app.request('/api/v1/rooms/room-1/grant', {
        headers: asUser(member.userId),
      });
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get('cache-control')).toBe('no-store');
      expect(await refreshed.json()).toMatchObject({ roomId: 'room-1', grant: expect.any(String) });
    } finally {
      relay.mockRestore();
    }
  });

  it('requires authentication and rate-limits join-token enumeration per IP', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);

    const unauthenticated = await app.request('/api/v1/join/unknown');
    expect(unauthenticated.status).toBe(401);

    const headers = {
      ...asUser(member.userId),
      'x-forwarded-for': '198.51.100.8',
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.request(`/api/v1/join/unknown-${attempt}`, { headers });
      expect(response.status).toBe(410);
    }
    const throttled = await app.request('/api/v1/join/unknown-10', { headers });
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({ error: 'rate_limited' });
  });

  it('mounts owner invite/revoke routes and authenticates the room-ended callback separately', async () => {
    const deps = setup();
    deps.db
      .insert(schema.rooms)
      .values({
        id: 'room-1',
        gameId: 'g-1',
        branchId: 'branch-1',
        buildId: 'build-1',
        ownerId: owner.userId,
        maxPlayers: 4,
        createdAt: now,
      })
      .run();
    deps.db.insert(schema.roomMembers).values({ roomId: 'room-1', userId: member.userId, joinedAt: now }).run();
    const relay = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const { app } = await makeApp(deps);

      const invitation = await app.request('/api/v1/rooms/room-1/invites', {
        method: 'POST',
        headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(invitation.status).toBe(201);
      expect(await invitation.json()).toMatchObject({
        url: expect.stringContaining('/join/'),
        expiresAt: expect.any(String),
      });

      expect(
        (
          await app.request('/api/v1/rooms/room-1/revoke', {
            method: 'POST',
            headers: { ...asUser(member.userId), 'content-type': 'application/json' },
            body: JSON.stringify({ userId: member.userId }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request('/api/v1/rooms/room-1/revoke', {
            method: 'POST',
            headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
            body: JSON.stringify({ userId: member.userId }),
          })
        ).status,
      ).toBe(204);
      expect(relay).toHaveBeenCalled();

      const body = JSON.stringify({ reason: 'owner-closed', endedAt: '2026-11-01T00:05:00.000Z' });
      expect(
        (
          await app.request('/internal/rooms/room-1/ended', {
            method: 'POST',
            headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
            body,
          })
        ).status,
      ).toBe(401);
      const authenticatedHeaders = {
        authorization: `Bearer ${deps.config.roomsInternalSecret}`,
        'content-type': 'application/json',
      };
      expect(
        (await app.request('/internal/rooms/room-1/ended', { method: 'POST', headers: authenticatedHeaders, body }))
          .status,
      ).toBe(204);
      const repeatedBody = JSON.stringify({ reason: 'idle', endedAt: '2026-11-01T00:06:00.000Z' });
      expect(
        (
          await app.request('/internal/rooms/room-1/ended', {
            method: 'POST',
            headers: authenticatedHeaders,
            body: repeatedBody,
          })
        ).status,
      ).toBe(204);
      expect(deps.db.select().from(schema.rooms).get()).toMatchObject({
        endedAt: '2026-11-01T00:05:00.000Z',
        endReason: 'owner-closed',
      });
    } finally {
      relay.mockRestore();
    }
  });
});
