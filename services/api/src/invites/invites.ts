import { randomUUID } from 'node:crypto';

import { schema } from '@ogm/db';
import { authorize, type Actor } from '@ogm/policy';
import { and, eq, gte, isNull } from 'drizzle-orm';

import { requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { hashOf, mint } from './tokens.js';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const INVITE_LIMIT = 10;

export type CreateInvitationInput =
  | { kind: 'member'; email: string; capability: 'creator' | 'player' }
  | { kind: 'play'; email: string; gameId: string }
  | { kind: 'room'; email?: string; gameId: string; roomId: string };

export type CreateInvitationOptions = {
  nowMs?: number;
  ttlMs?: number;
  delivery?: 'email' | 'link';
};

export type AcceptResult =
  | { kind: 'member'; familyId: string; capability: 'creator' | 'player' }
  | { kind: 'play'; gameId: string }
  | { kind: 'room'; gameId: string; roomId: string };

export async function createInvitation(
  deps: AppDeps,
  actor: Actor,
  input: CreateInvitationInput,
  options: CreateInvitationOptions = {},
): Promise<{ id: string; expiresAt: string; token: string }> {
  const { nowMs = Date.now(), ttlMs = INVITE_TTL_MS, delivery = 'email' } = options;
  requireAuthorization(authorize(actor, 'member.invite', { familyId: actor.familyId, inviteKind: input.kind }));

  const family = deps.db.select().from(schema.families).where(eq(schema.families.id, actor.familyId)).get();
  if (!family) throw new HttpError(404, 'family_not_found');
  if ('gameId' in input) {
    const game = deps.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(and(eq(schema.games.id, input.gameId), eq(schema.games.familyId, actor.familyId)))
      .get();
    if (!game) throw new HttpError(404, 'game_not_found');
  }

  const email = input.email?.trim().toLowerCase() ?? '';
  if (delivery === 'email' && !email) throw new HttpError(400, 'invite_email_required');
  if (input.kind !== 'member' && email) {
    const users = deps.registry.userDirectory;
    if (!users) throw new HttpError(503, 'user_directory_unavailable');
    const recipientId = await users.userIdForEmail(email);
    const isMember = recipientId
      ? Boolean(
          deps.db
            .select({ userId: schema.familyMembers.userId })
            .from(schema.familyMembers)
            .where(and(eq(schema.familyMembers.familyId, actor.familyId), eq(schema.familyMembers.userId, recipientId)))
            .get(),
        )
      : false;
    if (!isMember && !family.friendsAllowed) throw new HttpError(403, 'friends_not_allowed');
  }

  const since = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const recent = deps.db
    .select({ id: schema.invitations.id })
    .from(schema.invitations)
    .where(and(eq(schema.invitations.inviterId, actor.userId), gte(schema.invitations.createdAt, since)))
    .all();
  if (recent.length >= INVITE_LIMIT) throw new HttpError(429, 'invite_rate_limited');

  const id = `i_${randomUUID()}`;
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const token = mint();
  deps.db
    .insert(schema.invitations)
    .values({
      id,
      familyId: actor.familyId,
      kind: input.kind,
      email,
      tokenHash: token.hash,
      capability: input.kind === 'member' ? input.capability : null,
      gameId: input.kind === 'member' ? null : input.gameId,
      roomId: input.kind === 'room' ? input.roomId : null,
      inviterId: actor.userId,
      expiresAt,
      createdAt,
    })
    .run();

  if (delivery === 'email') {
    const mail = deps.registry.mailSender;
    if (!mail) {
      deps.db.delete(schema.invitations).where(eq(schema.invitations.id, id)).run();
      throw new HttpError(503, 'mail_sender_unavailable');
    }
    try {
      await mail.send({
        to: email,
        subject: 'Your Open Game Maker 2000 invitation',
        text: `Open this invitation before it expires: ${deps.config.appOrigin}/join/${token.token}`,
      });
    } catch {
      deps.db.delete(schema.invitations).where(eq(schema.invitations.id, id)).run();
      deps.log({ event: 'invite-mail-failed', inviteId: id, reason: 'send_failed' });
      throw new HttpError(502, 'mail_failed');
    }
  }
  return { id, expiresAt, token: token.token };
}

export async function acceptInvitation(
  deps: AppDeps,
  token: string,
  userId: string,
  nowMs = Date.now(),
): Promise<AcceptResult> {
  const invitation = deps.db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.tokenHash, hashOf(token)))
    .get();
  if (!invitation) throw new HttpError(404, 'invite_not_found');
  if (invitation.acceptedAt || invitation.revokedAt || Date.parse(invitation.expiresAt) <= nowMs) {
    throw new HttpError(410, 'invite_gone');
  }
  if (invitation.email) {
    const directory = deps.registry.userDirectory;
    if (!directory) throw new HttpError(503, 'user_directory_unavailable');
    const email = await directory.emailForUser(userId);
    if (!email) throw new HttpError(503, 'user_directory_unavailable');
    if (invitation.email.toLowerCase() !== email.toLowerCase()) throw new HttpError(403, 'invite_email_mismatch');
  }

  return deps.db.transaction((tx) => {
    const fresh = tx
      .select()
      .from(schema.invitations)
      .where(and(eq(schema.invitations.id, invitation.id), isNull(schema.invitations.acceptedAt)))
      .get();
    if (!fresh || fresh.revokedAt || Date.parse(fresh.expiresAt) <= nowMs) throw new HttpError(410, 'invite_gone');
    const acceptedAt = new Date(nowMs).toISOString();
    tx.update(schema.invitations)
      .set({ acceptedAt, acceptedBy: userId })
      .where(eq(schema.invitations.id, fresh.id))
      .run();

    if (fresh.kind === 'member') {
      const existing = tx
        .select({ familyId: schema.familyMembers.familyId })
        .from(schema.familyMembers)
        .where(eq(schema.familyMembers.userId, userId))
        .get();
      if (existing) throw new HttpError(409, 'already_in_family');
      const capability = fresh.capability ?? 'player';
      tx.insert(schema.familyMembers)
        .values({ familyId: fresh.familyId, userId, role: 'member', capability, joinedAt: acceptedAt })
        .run();
      return { kind: 'member', familyId: fresh.familyId, capability };
    }
    if (!fresh.gameId) throw new HttpError(410, 'invite_gone');
    if (fresh.kind === 'play') {
      tx.insert(schema.gameGrants)
        .values({ gameId: fresh.gameId, userId, sourceInviteId: fresh.id })
        .onConflictDoNothing()
        .run();
      return { kind: 'play', gameId: fresh.gameId };
    }
    if (!fresh.roomId) throw new HttpError(410, 'invite_gone');
    return { kind: 'room', gameId: fresh.gameId, roomId: fresh.roomId };
  });
}

export function invitationResponse(invitation: typeof schema.invitations.$inferSelect) {
  return {
    id: invitation.id,
    familyId: invitation.familyId,
    kind: invitation.kind,
    email: invitation.email,
    capability: invitation.capability,
    gameId: invitation.gameId,
    roomId: invitation.roomId,
    inviterId: invitation.inviterId,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  };
}
