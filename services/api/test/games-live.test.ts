import { schema } from '@ogm/db';
import { expect, it } from 'vitest';

import { ensureMainBranch } from '../src/design/store.js';
import { asUser, installUsers, makeApp, makeDeps } from './helpers.js';

const now = '2026-11-18T05:00:00.000Z';
const family = 'f_85400000-0000-4000-8000-000000000001';
const user = 'u_85400000-0000-4000-8000-000000000001';
const live = 'g_85400000-0000-4000-8000-000000000001';
const draft = 'g_85400000-0000-4000-8000-000000000002';

// Status (#854): "is everything in prod?" is answered per game in the menu, from whether it has a published release.
it('marks the games that have a published release as live', async () => {
  const deps = makeDeps();
  deps.db.insert(schema.families).values({ id: family, name: 'F', ownerUserId: user, createdAt: now }).run();
  for (const id of [live, draft])
    deps.db
      .insert(schema.games)
      .values({
        id,
        familyId: family,
        ownerId: user,
        title: id,
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: now,
      })
      .run();
  const main = ensureMainBranch(deps.sqlite, live, { id: 'b_01ARZ3NDEKTSV4RRFFQ69G5FAV', now: new Date(now) });
  deps.db
    .insert(schema.builds)
    .values({
      id: 'build_1',
      gameId: live,
      branchId: main.id,
      gitSha: 'a'.repeat(40),
      sdkVersion: '1.0.0',
      saveSchemaVersion: 1,
      achievementCatalogHash: 'b'.repeat(64),
      status: 'tested',
      artifact: 'present',
      artifactPath: '/artifacts/build_1',
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.overrideSnapshots)
    .values({
      id: 'snap_1',
      gameId: live,
      branchId: main.id,
      buildId: 'build_1',
      headRev: 0,
      sha256: '1'.repeat(64),
      entriesJson: '[]',
      entityOpsJson: '[]',
      foldSha: 'c'.repeat(40),
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.releases)
    .values({
      id: 'rel_1',
      gameId: live,
      seq: 1,
      version: '1.0.0',
      buildId: 'build_1',
      snapshotId: 'snap_1',
      gitTag: `gm/${live}/v1.0.0`,
      kind: 'publish',
      changelogJson: '{"summary":"Updates","items":[]}',
      publishedBy: user,
      publishedAt: now,
    })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: user,
      familyId: family,
      platformRole: 'none',
      capability: 'creator',
      email: 'u@example.test',
    },
  ]);
  const { app } = await makeApp(deps);
  const body = (await (await app.request('/api/v1/games', { headers: asUser(user) })).json()) as {
    games: { id: string; live: boolean }[];
  };
  expect(Object.fromEntries(body.games.map((game) => [game.id, game.live]))).toEqual({ [live]: true, [draft]: false });
});
