import { schema } from '@ogm/db';
import type { MailSender } from '../src/app/registry.js';
import { describe, expect, it } from 'vitest';

import { hashOf } from '../src/invites/tokens.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T00:00:00.000Z';
const familyId = 'f-family';
const admin: TestUser = {
  kind: 'user',
  userId: 'u-admin',
  displayName: 'Admin',
  email: 'admin@example.com',
  familyId,
  platformRole: 'admin',
  capability: 'creator',
};
const creator: TestUser = {
  kind: 'user',
  userId: 'u-creator',
  displayName: 'Creator',
  email: 'creator@example.com',
  familyId,
  platformRole: 'none',
  capability: 'creator',
};
const invitee: TestUser = {
  kind: 'user',
  userId: 'u-invitee',
  displayName: 'Invitee',
  email: 'invitee@example.com',
  familyId: '',
  platformRole: 'none',
  capability: 'player',
};
const wrongUser: TestUser = {
  kind: 'user',
  userId: 'u-wrong',
  displayName: 'Wrong User',
  email: 'wrong@example.com',
  familyId: '',
  platformRole: 'none',
  capability: 'player',
};

class RecordingMailSender implements MailSender {
  readonly messages: { to: string; subject: string; text: string }[] = [];
  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    this.messages.push(message);
  }
}

function setup() {
  const deps = makeDeps();
  installUsers(deps, [admin, creator, invitee, wrongUser]);
  const mail = new RecordingMailSender();
  deps.registry.mailSender = mail;
  deps.db
    .insert(schema.families)
    .values({ id: familyId, name: 'Household', ownerUserId: admin.userId, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId, userId: admin.userId, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId, userId: creator.userId, role: 'member', capability: 'creator', joinedAt: now },
    ])
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: 'g-private',
      familyId,
      ownerId: creator.userId,
      title: 'Private Game',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  return { deps, mail };
}

async function createInvite(
  app: Awaited<ReturnType<typeof makeApp>>['app'],
  user: TestUser,
  body: Record<string, unknown>,
) {
  return app.request('/api/v1/invites', {
    method: 'POST',
    headers: { ...asUser(user.userId), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function tokenFrom(mail: RecordingMailSender, index = -1): string {
  const message = mail.messages.at(index);
  const match = /\/join\/([A-Za-z0-9_-]+)/.exec(message?.text ?? '');
  if (!match) throw new Error('invite token missing from mail');
  return match[1];
}

describe('invitation routes', () => {
  it('stores only a hash and allows the same member to retry acceptance', async () => {
    const { deps, mail } = setup();
    const { app } = await makeApp(deps);
    const before = Date.now();
    const created = await createInvite(app, admin, {
      kind: 'member',
      email: invitee.email,
      capability: 'creator',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; expiresAt: string };
    expect(Date.parse(body.expiresAt) - before).toBeGreaterThanOrEqual(72 * 60 * 60 * 1000 - 1_000);
    expect(Date.parse(body.expiresAt) - before).toBeLessThanOrEqual(72 * 60 * 60 * 1000 + 1_000);
    const token = tokenFrom(mail);
    const stored = deps.db.select().from(schema.invitations).get();
    expect(stored?.tokenHash).toBe(hashOf(token));
    expect(stored?.tokenHash).not.toContain(token);

    const accepted = await app.request(`/api/v1/invites/${token}/accept`, {
      method: 'POST',
      headers: asUser(invitee.userId),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ kind: 'member', familyId, capability: 'creator' });
    expect(deps.lines.some((line) => JSON.stringify(line).includes(token))).toBe(false);
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'request', path: '/api/v1/invites/:token/accept' }),
    );
    expect(deps.db.select().from(schema.familyMembers).all()).toContainEqual(
      expect.objectContaining({ familyId, userId: invitee.userId, capability: 'creator' }),
    );
    expect(
      (
        await app.request(`/api/v1/invites/${token}/accept`, {
          method: 'POST',
          headers: asUser(invitee.userId),
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.request(`/api/v1/invites/${token}/accept`, { method: 'POST', headers: asUser(wrongUser.userId) }))
        .status,
    ).toBe(403);
  });

  it('binds acceptance to the signed-in user email and rejects expired tokens', async () => {
    const { deps, mail } = setup();
    const { app } = await makeApp(deps);
    await createInvite(app, admin, { kind: 'member', email: invitee.email, capability: 'player' });
    const token = tokenFrom(mail);
    const mismatch = await app.request(`/api/v1/invites/${token}/accept`, {
      method: 'POST',
      headers: asUser(wrongUser.userId),
    });
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ error: 'invite_email_mismatch' });

    deps.sqlite
      .prepare('UPDATE invitations SET expires_at = ? WHERE token_hash = ?')
      .run('2020-01-01T00:00:00.000Z', hashOf(token));
    const expired = await app.request(`/api/v1/invites/${token}/accept`, {
      method: 'POST',
      headers: asUser(invitee.userId),
    });
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({ error: 'invite_gone' });
  });

  it('gates outside play invites behind friends_allowed and lets the inviter revoke', async () => {
    const { deps, mail } = setup();
    const { app } = await makeApp(deps);
    const input = { kind: 'play', email: 'friend@example.com', gameId: 'g-private' };
    const blocked = await createInvite(app, creator, input);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: 'friends_not_allowed' });

    deps.sqlite.prepare('UPDATE families SET friends_allowed = 1 WHERE id = ?').run(familyId);
    const created = await createInvite(app, creator, input);
    expect(created.status).toBe(201);
    expect(mail.messages).toHaveLength(1);
    const invitation = deps.db.select().from(schema.invitations).get();
    expect(
      (
        await createInvite(app, admin, {
          kind: 'member',
          email: invitee.email,
          capability: 'player',
        })
      ).status,
    ).toBe(201);
    const listed = await app.request('/api/v1/invites', { headers: asUser(creator.userId) });
    expect(((await listed.json()) as { invitations: { id: string }[] }).invitations).toEqual([
      expect.objectContaining({ id: invitation?.id }),
    ]);
    const adminList = await app.request('/api/v1/invites', { headers: asUser(admin.userId) });
    expect(((await adminList.json()) as { invitations: unknown[] }).invitations).toHaveLength(2);
    const revoked = await app.request(`/api/v1/invites/${invitation?.id}`, {
      method: 'DELETE',
      headers: asUser(creator.userId),
    });
    expect(revoked.status).toBe(204);
    expect(deps.db.select().from(schema.invitations).get()?.revokedAt).not.toBeNull();
  });

  it('turns an accepted play invitation into a private-game grant', async () => {
    const { deps, mail } = setup();
    deps.sqlite.prepare('UPDATE families SET friends_allowed = 1 WHERE id = ?').run(familyId);
    const { app } = await makeApp(deps);
    expect(
      (
        await createInvite(app, creator, {
          kind: 'play',
          email: invitee.email,
          gameId: 'g-private',
        })
      ).status,
    ).toBe(201);
    const token = tokenFrom(mail);
    const accepted = await app.request(`/api/v1/invites/${token}/accept`, {
      method: 'POST',
      headers: asUser(invitee.userId),
    });
    expect(await accepted.json()).toEqual({ kind: 'play', gameId: 'g-private' });
    expect(deps.db.select().from(schema.gameGrants).get()).toMatchObject({
      gameId: 'g-private',
      userId: invitee.userId,
    });
  });

  it('gates room invitations and returns the room target after acceptance', async () => {
    const { deps, mail } = setup();
    const { app } = await makeApp(deps);
    const input = { kind: 'room', email: invitee.email, gameId: 'g-private', roomId: 'room-1' };
    expect((await createInvite(app, creator, input)).status).toBe(403);
    deps.sqlite.prepare('UPDATE families SET friends_allowed = 1 WHERE id = ?').run(familyId);
    expect((await createInvite(app, creator, input)).status).toBe(201);
    const accepted = await app.request(`/api/v1/invites/${tokenFrom(mail)}/accept`, {
      method: 'POST',
      headers: asUser(invitee.userId),
    });
    expect(await accepted.json()).toEqual({ kind: 'room', gameId: 'g-private', roomId: 'room-1' });
  });

  it('removes an unusable invitation when mail delivery fails', async () => {
    const { deps } = setup();
    deps.registry.mailSender = {
      send: async (message) => {
        throw new Error(`mail offline: ${message.text}`);
      },
    };
    const { app } = await makeApp(deps);
    const response = await createInvite(app, admin, {
      kind: 'member',
      email: invitee.email,
      capability: 'player',
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'mail_failed' });
    expect(deps.db.select().from(schema.invitations).all()).toEqual([]);
    expect(deps.lines).toContainEqual(expect.objectContaining({ event: 'invite-mail-failed', reason: 'send_failed' }));
    expect(deps.lines.some((line) => JSON.stringify(line).includes('/join/'))).toBe(false);
  });

  it('allows ten invitations per inviter in a rolling day and rejects the eleventh', async () => {
    const { deps } = setup();
    const { app } = await makeApp(deps);
    for (let index = 0; index < 10; index += 1) {
      const response = await createInvite(app, admin, {
        kind: 'member',
        email: `person-${index}@example.com`,
        capability: 'player',
      });
      expect(response.status).toBe(201);
    }
    const limited = await createInvite(app, admin, {
      kind: 'member',
      email: 'person-10@example.com',
      capability: 'player',
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'invite_rate_limited' });
  });

  it('does not let a creator issue a member invitation', async () => {
    const { deps } = setup();
    const { app } = await makeApp(deps);
    const response = await createInvite(app, creator, {
      kind: 'member',
      email: invitee.email,
      capability: 'creator',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not_allowed' });
  });
});
