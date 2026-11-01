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
  familyId,
  platformRole: 'none',
  capability: 'creator',
};
const member: TestUser = {
  kind: 'user',
  userId: 'u-member',
  email: 'member@example.com',
  familyId,
  platformRole: 'none',
  capability: 'player',
};
const friend: TestUser = {
  kind: 'user',
  userId: 'u-friend',
  email: 'friend@example.com',
  familyId: 'f-friend',
  platformRole: 'none',
  capability: 'player',
};

function setup() {
  const deps = makeDeps();
  installUsers(deps, [owner, member, friend]);
  deps.db
    .insert(schema.families)
    .values({ id: familyId, name: 'Household', ownerUserId: owner.userId, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId, userId: owner.userId, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId, userId: member.userId, role: 'member', capability: 'player', joinedAt: now },
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
      { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1', maxPlayers: 99, displayName: 'Owner' },
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
      grant: { sub: owner.userId, roomId: 'room-1', role: 'owner', name: 'Owner' },
    });
    expect(await relay.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1', ownerId: owner.userId, maxPlayers: 8 }),
    );
    expect(deps.db.select().from(schema.rooms).get()).toMatchObject({ id: 'room-1', maxPlayers: 8 });

    const reused = await createRoom(
      deps,
      owner,
      { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1', displayName: 'Owner' },
      nowMs,
      relay,
    );
    expect(reused.roomId).toBe('room-1');
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it('does not persist a room when the relay is unavailable', async () => {
    const deps = setup();
    const relay = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      createRoom(
        deps,
        owner,
        { gameId: 'g-1', branchId: 'branch-1', buildId: 'build-1', displayName: 'Owner' },
        nowMs,
        relay,
      ),
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

    const joined = await joinRoom(deps, member, token, 'Member', nowMs);
    expect((await verifyGrant(joined.grant, deps.config.roomGrantSecret, nowMs)).ok).toBe(true);
    expect(deps.db.select().from(schema.roomMembers).get()).toMatchObject({
      roomId: 'room-1',
      userId: member.userId,
    });
    await expect(joinRoom(deps, member, token, 'Member', nowMs)).resolves.toMatchObject({ roomId: 'room-1' });
    await expect(joinRoom(deps, friend, token, 'Friend', nowMs)).rejects.toMatchObject({
      status: 410,
      code: 'invite_gone',
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
    deps.db
      .insert(schema.roomMembers)
      .values({ roomId: 'room-1', userId: member.userId, joinedAt: now })
      .run();

    await expect(freshRoomGrant(deps, member, 'room-1', 'Member', nowMs)).resolves.toMatchObject({ roomId: 'room-1' });
    const relay = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await revokeRoomAccess(deps, owner, 'room-1', { userId: member.userId }, nowMs, relay);
    expect(deps.db.select().from(schema.roomMembers).get()?.revokedAt).toBe(now);
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
    deps.db
      .insert(schema.roomMembers)
      .values({ roomId: 'room-1', userId: member.userId, joinedAt: now })
      .run();
    const relay = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
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
    expect(
      (
        await app.request('/internal/rooms/room-1/ended', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${deps.config.roomsInternalSecret}`,
            'content-type': 'application/json',
          },
          body,
        })
      ).status,
    ).toBe(204);
    expect(deps.db.select().from(schema.rooms).get()).toMatchObject({ endReason: 'owner-closed' });
    relay.mockRestore();
  });
});
