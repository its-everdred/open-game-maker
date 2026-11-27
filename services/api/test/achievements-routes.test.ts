import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { registerCatalog } from '../src/achievements/catalog.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T00:00:00.000Z';
const familyId = 'f-achievement-routes';
const creator: TestUser = {
  kind: 'user',
  userId: 'u-creator',
  displayName: 'Creator',
  email: 'creator@example.test',
  familyId,
  platformRole: 'none',
  capability: 'creator',
};
const player: TestUser = {
  kind: 'user',
  userId: 'u-player',
  displayName: 'Player',
  email: 'player@example.test',
  familyId,
  platformRole: 'none',
  capability: 'player',
};
const admin: TestUser = {
  kind: 'user',
  userId: 'u-admin',
  displayName: 'Admin',
  email: 'admin@example.test',
  familyId,
  platformRole: 'admin',
  capability: 'creator',
};

function seed(deps: ReturnType<typeof makeDeps>) {
  installUsers(deps, [creator, player, admin]);
  deps.db
    .insert(schema.families)
    .values({ id: familyId, name: 'Family', ownerUserId: creator.userId, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId, userId: creator.userId, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId, userId: player.userId, role: 'member', capability: 'player', joinedAt: now },
      { familyId, userId: admin.userId, role: 'admin', capability: 'creator', joinedAt: now },
    ])
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: 'g-achievements',
      familyId,
      ownerId: creator.userId,
      title: 'Castle',
      visibility: 'listed',
      publishedReleaseId: 'rel-1',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  registerCatalog(
    deps.db,
    'g-achievements',
    'rel-1',
    [
      {
        key: 'secret-room',
        title: 'Behind the Wall',
        description: 'Find the secret room',
        icon: 'secret.png',
        hidden: true,
      },
    ],
    now,
  );
}

describe('achievement routes', () => {
  it('hides an unearned definition, awards it, and records an admin revoke audit', async () => {
    const deps = makeDeps();
    seed(deps);
    const { app } = await makeApp(deps);

    const before = await app.request('/api/v1/games/g-achievements/achievements', { headers: asUser(player.userId) });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({
      achievements: [expect.objectContaining({ key: 'secret-room', title: '???', description: '???', earned: false })],
    });

    const awarded = await app.request('/api/v1/games/g-achievements/achievements/award', {
      method: 'POST',
      headers: { ...asUser(player.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'secret-room', releaseId: 'rel-1' }),
    });
    expect(awarded.status).toBe(200);
    expect(await awarded.json()).toEqual({ newlyAwarded: true });

    const after = await app.request('/api/v1/games/g-achievements/achievements', { headers: asUser(player.userId) });
    expect(await after.json()).toEqual({
      achievements: [
        expect.objectContaining({
          key: 'secret-room',
          title: 'Behind the Wall',
          earned: true,
          awardedAt: expect.any(String),
        }),
      ],
    });

    const revoked = await app.request('/api/v1/games/g-achievements/achievements/awards/u-player/secret-room', {
      method: 'DELETE',
      headers: asUser(admin.userId),
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ revoked: true });
    expect(deps.db.select().from(schema.achievementAudit).all()).toEqual([
      expect.objectContaining({ userId: player.userId, key: 'secret-room', action: 'revoke', byUserId: admin.userId }),
    ]);
  });

  it('maps catalog validation errors to 422 and rejects non-admin revocation', async () => {
    const deps = makeDeps();
    seed(deps);
    const { app } = await makeApp(deps);
    const unpublished = await app.request('/api/v1/games/g-achievements/achievements/award', {
      method: 'POST',
      headers: { ...asUser(player.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'secret-room', releaseId: 'draft' }),
    });
    expect(unpublished.status).toBe(422);
    expect(await unpublished.json()).toEqual({ error: 'not_published' });

    const forbidden = await app.request('/api/v1/games/g-achievements/achievements/awards/u-player/secret-room', {
      method: 'DELETE',
      headers: asUser(player.userId),
    });
    expect(forbidden.status).toBe(403);
  });
});
