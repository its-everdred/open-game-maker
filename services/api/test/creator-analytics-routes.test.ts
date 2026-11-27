import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { rollup } from '../src/creator-analytics/rollup.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T12:00:00.000Z';
const familyId = 'f-analytics-routes';
const branchId = 'branch_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const releaseId = 'release_01ARZ3NDEKTSV4RRFFQ69G5FAV';
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
  capability: 'player',
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
      { familyId, userId: admin.userId, role: 'admin', capability: 'player', joinedAt: now },
    ])
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: 'g-analytics',
      familyId,
      ownerId: creator.userId,
      title: 'Analytics',
      visibility: 'listed',
      publishedReleaseId: 'rel-fixture',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
}

function playEvent(sessionId: string, env: 'draft' | 'published' = 'published') {
  return { ts: now, branchId, releaseId, env, sessionId, name: 'session_start' };
}

describe('creator analytics routes', () => {
  it('caps batches, stores valid events, and limits creator queries to the owner', async () => {
    const deps = makeDeps();
    seed(deps);
    const { app } = await makeApp(deps);

    const oversized = await app.request('/api/v1/games/g-analytics/play-events', {
      method: 'POST',
      headers: { ...asUser(player.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ events: Array.from({ length: 201 }, (_, index) => playEvent(`s-${index}`)) }),
    });
    expect(oversized.status).toBe(413);

    const accepted = await app.request('/api/v1/games/g-analytics/play-events', {
      method: 'POST',
      headers: { ...asUser(player.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ events: [playEvent('published'), playEvent('draft', 'draft')] }),
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ accepted: 2, rejected: 0, reasons: [] });
    rollup(deps.db, '2026-11-01', { now: '2026-11-02T01:00:00.000Z' });

    const overview = await app.request('/api/v1/games/g-analytics/analytics/overview?from=2026-11-01&to=2026-11-01', {
      headers: asUser(creator.userId),
    });
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({ plays: 1, players: 1, testRuns: 1 });

    const adminOverview = await app.request(
      '/api/v1/games/g-analytics/analytics/overview?from=2026-11-01&to=2026-11-01',
      { headers: asUser(admin.userId) },
    );
    expect(adminOverview.status).toBe(200);

    const forbidden = await app.request('/api/v1/games/g-analytics/analytics/overview?from=2026-11-01&to=2026-11-01', {
      headers: asUser(player.userId),
    });
    expect(forbidden.status).toBe(403);
  });
});
