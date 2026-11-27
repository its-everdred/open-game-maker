import { schema } from '@ogm/db';

import { asUser, installUsers, makeApp, makeDeps } from './helpers.js';

export const ids = {
  family: 'f_70000000-0000-4000-8000-000000000001',
  owner: 'u_70000000-0000-4000-8000-000000000001',
  player: 'u_70000000-0000-4000-8000-000000000002',
  admin: 'u_70000000-0000-4000-8000-000000000003',
  outsider: 'u_70000000-0000-4000-8000-000000000004',
  game: 'g_70000000-0000-4000-8000-000000000001',
  otherGame: 'g_70000000-0000-4000-8000-000000000002',
  privateGame: 'g_70000000-0000-4000-8000-000000000003',
  release: 'r_70000000-0000-4000-8000-000000000001',
};
export const BUILD_HASH = 'a'.repeat(64);
const AT = '2026-11-01T16:00:00.000Z';

// The worked example from the ticket.
export function crash(gameId: string = ids.game, file = `/g/${gameId}/b_1f2e3d4c/systems/combat.js`) {
  return {
    gameId,
    buildHash: BUILD_HASH,
    error: {
      type: 'TypeError',
      message: "Cannot read properties of undefined (reading 'hp') at tick 4312",
      frames: [{ file, line: 88, fn: 'applyDamage' }],
    },
  };
}

export async function reportsApp(input: { ownerDaily?: number } = {}) {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.owner, createdAt: AT })
    .run();
  const members = [
    { userId: ids.owner, role: 'owner' as const, capability: 'creator' as const },
    { userId: ids.player, role: 'member' as const, capability: 'player' as const },
    { userId: ids.admin, role: 'admin' as const, capability: 'creator' as const },
    { userId: ids.outsider, role: 'member' as const, capability: 'player' as const },
  ];
  for (const member of members) {
    deps.db
      .insert(schema.familyMembers)
      .values({ familyId: ids.family, joinedAt: AT, ...member })
      .run();
  }
  for (const [id, visibility] of [
    [ids.game, 'listed'],
    [ids.otherGame, 'listed'],
    [ids.privateGame, 'private'],
  ] as const) {
    deps.db
      .insert(schema.games)
      .values({
        id,
        familyId: ids.family,
        ownerId: ids.owner,
        title: id,
        visibility,
        publishedReleaseId: visibility === 'listed' ? ids.release : null,
        repoVisibility: 'private',
        createdAt: AT,
      })
      .run();
  }
  if (input.ownerDaily !== undefined) {
    deps.db
      .insert(schema.allowances)
      .values({ familyId: ids.family, userId: ids.owner, dailyMicroUsd: input.ownerDaily })
      .run();
  }
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.owner,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'o@example.test',
    },
    {
      kind: 'user',
      userId: ids.player,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'player',
      email: 'p@example.test',
    },
    {
      kind: 'user',
      userId: ids.admin,
      familyId: ids.family,
      platformRole: 'admin',
      capability: 'creator',
      email: 'a@example.test',
    },
    {
      kind: 'user',
      userId: ids.outsider,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'player',
      email: 'x@example.test',
    },
  ]);
  const { app } = await makeApp(deps);
  const post = (body: unknown, user: string = ids.player) =>
    app.request('/api/v1/reports', {
      method: 'POST',
      headers: { ...asUser(user), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { app, deps, post };
}
