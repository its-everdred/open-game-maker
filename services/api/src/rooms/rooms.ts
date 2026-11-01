import type { Principal } from '@ogm/contracts';
import { LIMITS } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { signGrant } from '@ogm/room-protocol';
import { and, eq, isNull } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { createInvitation } from '../invites/invites.js';
import { hashOf } from '../invites/tokens.js';
import { createRelayRoom, revokeRelayRoom } from './client.js';

const ROOM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type UserPrincipal = Extract<Principal, { kind: 'user' }>;
type RoomRow = typeof schema.rooms.$inferSelect;
type RoomGrantResponse = {
  roomId: string;
  grant: string;
  pin: { gameId: string; branchId: string; buildId: string };
  roomsUrl: string;
};

function requireRoomOwner(room: RoomRow, principal: UserPrincipal): void {
  if (room.ownerId !== principal.userId) throw new HttpError(403, 'not_owner');
}

function requireName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 40) throw new HttpError(503, 'display_name_unavailable');
  return normalized;
}

function roomsUrl(deps: AppDeps): string {
  return `${deps.config.publicOrigin.replace(/\/$/, '')}/ws/rooms`;
}

async function grantResponse(
  deps: AppDeps,
  room: RoomRow,
  userId: string,
  role: 'owner' | 'player',
  displayName: string,
  nowMs: number,
): Promise<RoomGrantResponse> {
  if (room.endedAt) throw new HttpError(410, 'room_ended');
  return {
    roomId: room.id,
    grant: await signGrant(
      { sub: userId, roomId: room.id, gameId: room.gameId, role, name: requireName(displayName) },
      deps.config.roomGrantSecret,
      nowMs,
    ),
    pin: { gameId: room.gameId, branchId: room.branchId, buildId: room.buildId },
    roomsUrl: roomsUrl(deps),
  };
}

export async function createRoom(
  deps: AppDeps,
  principal: UserPrincipal,
  input: { gameId: string; branchId: string; buildId: string; maxPlayers?: number; displayName: string },
  nowMs = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<RoomGrantResponse> {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, input.gameId)).get();
  if (!game) throw new HttpError(404, 'game_not_found');
  if (game.ownerId !== principal.userId) throw new HttpError(403, 'not_owner');

  const existing = deps.db
    .select()
    .from(schema.rooms)
    .where(
      and(
        eq(schema.rooms.gameId, input.gameId),
        eq(schema.rooms.branchId, input.branchId),
        isNull(schema.rooms.endedAt),
      ),
    )
    .get();
  if (existing) return grantResponse(deps, existing, principal.userId, 'owner', input.displayName, nowMs);

  const maxPlayers = Math.min(
    Math.max(Math.floor(input.maxPlayers ?? LIMITS.maxPlayersDefault), 1),
    LIMITS.maxPlayersCeiling,
  );
  const created = await createRelayRoom(
    deps,
    {
      gameId: input.gameId,
      branchId: input.branchId,
      buildId: input.buildId,
      ownerId: principal.userId,
      maxPlayers,
    },
    fetchImpl,
  );
  const room: RoomRow = {
    id: created.roomId,
    gameId: input.gameId,
    branchId: input.branchId,
    buildId: input.buildId,
    ownerId: principal.userId,
    maxPlayers,
    createdAt: new Date(nowMs).toISOString(),
    endedAt: null,
    endReason: null,
  };
  deps.db.insert(schema.rooms).values(room).run();
  return grantResponse(deps, room, principal.userId, 'owner', input.displayName, nowMs);
}

export async function createRoomInvitation(
  deps: AppDeps,
  principal: UserPrincipal,
  roomId: string,
  input: { email?: string },
  nowMs = Date.now(),
): Promise<{ url: string; expiresAt: string }> {
  const room = deps.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).get();
  if (!room) throw new HttpError(404, 'room_not_found');
  requireRoomOwner(room, principal);
  if (room.endedAt) throw new HttpError(410, 'room_ended');

  const created = await createInvitation(
    deps,
    actorFromPrincipal(principal),
    { kind: 'room', email: input.email, gameId: room.gameId, roomId },
    { nowMs, ttlMs: ROOM_INVITE_TTL_MS, delivery: 'link' },
  );
  return { url: `${deps.config.appOrigin.replace(/\/$/, '')}/join/${created.token}`, expiresAt: created.expiresAt };
}

export async function joinRoom(
  deps: AppDeps,
  principal: UserPrincipal,
  token: string,
  displayName: string,
  nowMs = Date.now(),
): Promise<RoomGrantResponse> {
  const invitation = deps.db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.tokenHash, hashOf(token)))
    .get();
  if (!invitation || invitation.kind !== 'room' || !invitation.gameId || !invitation.roomId) {
    throw new HttpError(410, 'invite_gone');
  }
  if (invitation.revokedAt || Date.parse(invitation.expiresAt) <= nowMs) throw new HttpError(410, 'invite_gone');
  if (invitation.acceptedAt && invitation.acceptedBy !== principal.userId) throw new HttpError(410, 'invite_gone');

  const room = deps.db.select().from(schema.rooms).where(eq(schema.rooms.id, invitation.roomId)).get();
  if (!room || room.gameId !== invitation.gameId) throw new HttpError(410, 'invite_gone');
  if (room.endedAt) throw new HttpError(410, 'room_ended');
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, room.gameId)).get();
  const family = game
    ? deps.db.select().from(schema.families).where(eq(schema.families.id, game.familyId)).get()
    : undefined;
  if (!game || !family) throw new HttpError(410, 'invite_gone');
  if (principal.familyId !== game.familyId && !family.friendsAllowed) {
    throw new HttpError(403, 'friends_not_allowed');
  }
  requireAuthorization(
    authorize(actorFromPrincipal(principal), 'game.play', {
      ownerId: game.ownerId,
      visibility: game.visibility,
      granted: true,
    }),
  );

  if (invitation.email) {
    const directory = deps.registry.userDirectory;
    if (!directory) throw new HttpError(503, 'user_directory_unavailable');
    const email = await directory.emailForUser(principal.userId);
    if (!email) throw new HttpError(503, 'user_directory_unavailable');
    if (email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new HttpError(403, 'invite_email_mismatch');
    }
  }

  deps.db.transaction((tx) => {
    const fresh = tx.select().from(schema.invitations).where(eq(schema.invitations.id, invitation.id)).get();
    if (!fresh || fresh.revokedAt || Date.parse(fresh.expiresAt) <= nowMs) throw new HttpError(410, 'invite_gone');
    if (fresh.acceptedAt && fresh.acceptedBy !== principal.userId) throw new HttpError(410, 'invite_gone');

    const existing = tx
      .select()
      .from(schema.roomMembers)
      .where(and(eq(schema.roomMembers.roomId, room.id), eq(schema.roomMembers.userId, principal.userId)))
      .get();
    if (existing?.revokedAt) throw new HttpError(403, 'membership_revoked');
    const acceptedAt = fresh.acceptedAt ?? new Date(nowMs).toISOString();
    if (!fresh.acceptedAt) {
      tx.update(schema.invitations)
        .set({ acceptedAt, acceptedBy: principal.userId })
        .where(and(eq(schema.invitations.id, fresh.id), isNull(schema.invitations.acceptedAt)))
        .run();
    }
    if (!existing) {
      tx.insert(schema.roomMembers)
        .values({ roomId: room.id, userId: principal.userId, invitationId: fresh.id, joinedAt: acceptedAt })
        .run();
    }
  });

  return grantResponse(deps, room, principal.userId, 'player', displayName, nowMs);
}

export async function freshRoomGrant(
  deps: AppDeps,
  principal: UserPrincipal,
  roomId: string,
  displayName: string,
  nowMs = Date.now(),
): Promise<RoomGrantResponse> {
  const room = deps.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).get();
  if (!room) throw new HttpError(404, 'room_not_found');
  if (room.ownerId === principal.userId) {
    return grantResponse(deps, room, principal.userId, 'owner', displayName, nowMs);
  }
  const member = deps.db
    .select()
    .from(schema.roomMembers)
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, principal.userId)))
    .get();
  if (!member || member.revokedAt) throw new HttpError(403, 'not_room_member');
  return grantResponse(deps, room, principal.userId, 'player', displayName, nowMs);
}

export async function revokeRoomAccess(
  deps: AppDeps,
  principal: UserPrincipal,
  roomId: string,
  input: { jti?: string; userId?: string },
  nowMs = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const room = deps.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).get();
  if (!room) throw new HttpError(404, 'room_not_found');
  requireRoomOwner(room, principal);
  if (room.endedAt) throw new HttpError(410, 'room_ended');
  await revokeRelayRoom(deps, roomId, input, fetchImpl);
  if (input.userId) {
    deps.db
      .update(schema.roomMembers)
      .set({ revokedAt: new Date(nowMs).toISOString() })
      .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, input.userId)))
      .run();
  }
}

export function recordRoomEnded(
  deps: AppDeps,
  roomId: string,
  input: { reason: string; endedAt: string },
): void {
  const room = deps.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).get();
  if (!room) throw new HttpError(404, 'room_not_found');
  if (room.endedAt) return;
  deps.db
    .update(schema.rooms)
    .set({ endedAt: input.endedAt, endReason: input.reason })
    .where(and(eq(schema.rooms.id, roomId), isNull(schema.rooms.endedAt)))
    .run();
}
