import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { createGameRow, getGameAccess } from '../src/games/games.js';
import { addAllowedUser, setAllowedRole } from '../src/auth/allow-list.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const owner: TestUser = {
  kind: 'user',
  userId: 'owner',
  displayName: 'Owner',
  email: 'owner@example.test',
  familyId: 'family',
  platformRole: 'none',
  capability: 'creator',
};
const editor: TestUser = { ...owner, userId: 'editor', displayName: 'Editor', email: 'editor@example.test' };
const player: TestUser = { ...editor, userId: 'player', email: 'player@example.test', capability: 'player' };
const outsider: TestUser = { ...editor, userId: 'outsider', email: 'outsider@example.test', familyId: 'other' };

async function setup() {
  const deps = makeDeps();
  installUsers(deps, [owner, editor, player, outsider]);
  const now = new Date();
  deps.db
    .insert(schema.families)
    .values({ id: 'family', name: 'Family', ownerUserId: owner.userId, createdAt: now.toISOString() })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: 'game',
      familyId: 'family',
      ownerId: owner.userId,
      title: 'Game',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: now.toISOString(),
    })
    .run();
  deps.db
    .insert(schema.allowedUsers)
    .values([
      { email: owner.email, role: 'maker', addedBy: owner.userId, addedAt: now.toISOString() },
      { email: editor.email, role: 'maker', addedBy: owner.userId, addedAt: now.toISOString() },
      { email: player.email, role: 'player', addedBy: owner.userId, addedAt: now.toISOString() },
      { email: outsider.email, role: 'maker', addedBy: owner.userId, addedAt: now.toISOString() },
      { email: 'invited@example.test', role: 'maker', addedBy: owner.userId, addedAt: now.toISOString() },
    ])
    .run();
  deps.db
    .insert(schema.user)
    .values(
      [owner, editor, player, outsider].map((user) => ({
        id: user.userId,
        email: user.email,
        name: user.displayName,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  return { deps, ...(await makeApp(deps)) };
}

const put = (app: Awaited<ReturnType<typeof makeApp>>['app'], actor: string, email: string, access: string) =>
  app.request(`/api/v1/games/game/access/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { ...asUser(actor), 'content-type': 'application/json' },
    body: JSON.stringify({ access }),
  });

describe('game access', () => {
  it('updates an existing player membership when promoted to editor', async () => {
    const { deps } = await setup();
    deps.db
      .insert(schema.familyMembers)
      .values({
        familyId: owner.familyId,
        userId: player.userId,
        role: 'member',
        capability: 'player',
        joinedAt: new Date().toISOString(),
      })
      .run();
    expect(setAllowedRole(deps.db, player.email, 'maker', owner.userId)).toBe(true);
    expect(
      deps.db
        .select()
        .from(schema.familyMembers)
        .all()
        .find((member) => member.userId === player.userId)?.capability,
    ).toBe('creator');
  });

  it('keeps pending invitations hidden on games created before or after the invite', async () => {
    const { deps } = await setup();
    addAllowedUser(deps.db, { email: 'new@example.test', role: 'maker', addedBy: owner.userId });
    const later = createGameRow(deps.db, {
      familyId: owner.familyId,
      ownerId: owner.userId,
      title: 'Later',
      repoVisibility: 'private',
    });
    const now = new Date();
    deps.db
      .insert(schema.user)
      .values({
        id: 'new',
        email: 'new@example.test',
        name: 'New',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    expect(getGameAccess(deps.db, 'game', 'new')).toBe('hide');
    expect(getGameAccess(deps.db, later.id, 'new')).toBe('hide');
  });

  it('lets the owner set an invited editor access before their first sign-in', async () => {
    const { app, deps } = await setup();
    expect((await put(app, owner.userId, 'invited@example.test', 'edit')).status).toBe(200);
    const now = new Date();
    deps.db
      .insert(schema.user)
      .values({
        id: 'invited',
        email: 'invited@example.test',
        name: 'Invited',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    expect(getGameAccess(deps.db, 'game', 'invited')).toBe('edit');
    expect((await put(app, owner.userId, 'invited@example.test', 'hide')).status).toBe(200);
    expect(getGameAccess(deps.db, 'game', 'invited')).toBe('hide');
    expect(
      deps.db
        .select()
        .from(schema.gameAccessAudit)
        .all()
        .map((row) => [row.previousAccess, row.access]),
    ).toEqual([
      [null, 'edit'],
      ['edit', 'hide'],
    ]);
  });

  it('rejects changes by nonowners and edit access for players', async () => {
    const { app } = await setup();
    expect((await put(app, editor.userId, editor.email, 'edit')).status).toBe(403);
    expect((await put(app, owner.userId, player.email, 'edit')).status).toBe(400);
    expect((await put(app, owner.userId, owner.email, 'hide')).status).toBe(409);
  });

  it('applies play and hide to a private game even after a grant changes', async () => {
    const { app } = await setup();
    const read = () => app.request('/api/v1/games/game', { headers: asUser(editor.userId) });
    expect((await read()).status).toBe(403);
    expect((await put(app, owner.userId, editor.email, 'play')).status).toBe(200);
    expect((await read()).status).toBe(200);
    expect((await put(app, owner.userId, editor.email, 'hide')).status).toBe(200);
    expect((await read()).status).toBe(403);
  });

  it('allows only a granted editor to read a game ticket chat', async () => {
    const { app, deps } = await setup();
    deps.registry.chatJobs = {
      get: async () => ({
        jobId: 'job',
        gameId: 'game',
        familyId: 'family',
        ownerId: owner.userId,
        kind: 'feature',
        state: 'running',
        aiur: null,
      }),
      active: async () => [],
    };
    const read = (userId: string) => app.request('/api/v1/jobs/job/chat/messages', { headers: asUser(userId) });
    expect((await read(editor.userId)).status).toBe(403);
    expect((await put(app, owner.userId, editor.email, 'edit')).status).toBe(200);
    expect((await read(editor.userId)).status).toBe(200);
    const listing = await app.request('/api/v1/games', { headers: asUser(editor.userId) });
    const body = (await listing.json()) as { games: Array<{ id: string; canEdit: boolean; canManageAccess: boolean }> };
    expect(body.games.find((game) => game.id === 'game')).toMatchObject({ canEdit: true, canManageAccess: false });
    expect((await app.request('/api/v1/games/game/editor/previews', { headers: asUser(editor.userId) })).status).toBe(
      200,
    );
    expect((await read(player.userId)).status).toBe(403);
    expect((await put(app, owner.userId, editor.email, 'hide')).status).toBe(200);
    expect((await read(editor.userId)).status).toBe(403);
  });

  it('removes edit access when a user becomes a player', async () => {
    const { app, deps } = await setup();
    expect((await put(app, owner.userId, editor.email, 'edit')).status).toBe(200);
    expect(setAllowedRole(deps.db, editor.email, 'player', owner.userId)).toBe(true);
    expect(getGameAccess(deps.db, 'game', editor.userId)).toBe('play');
    expect(deps.db.select().from(schema.gameAccessAudit).all().at(-1)).toMatchObject({
      previousAccess: 'edit',
      access: 'play',
      actorId: owner.userId,
    });
  });

  it('allows an editor in another family only after an explicit grant', async () => {
    const { app } = await setup();
    const previews = () => app.request('/api/v1/games/game/editor/previews', { headers: asUser(outsider.userId) });
    expect((await previews()).status).toBe(404);
    expect((await put(app, owner.userId, outsider.email, 'edit')).status).toBe(200);
    expect((await previews()).status).toBe(200);
    expect((await put(app, owner.userId, outsider.email, 'hide')).status).toBe(200);
    expect((await previews()).status).toBe(404);
  });
});
