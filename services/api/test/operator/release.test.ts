import { eq } from 'drizzle-orm';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { expect, it } from 'vitest';
import { createApp } from '../../src/app/app.js';
import artifacts from '../../src/artifacts/routes.js';
import operatorRoutes, { prefix } from '../../src/operator/routes.js';
import { INTERNAL_TOKEN } from '../helpers.js';
import { ids, insertBuild, setup } from '../release-fixtures.js';

it('lets the operator release the current tested build without an owner session', async () => {
  const { deps, source } = setup();
  deps.registry.principalResolvers.push(async (c) =>
    c.req.header('cookie') === 'session=owner'
      ? {
          kind: 'user',
          userId: ids.user,
          familyId: ids.family,
          displayName: 'Owner',
          platformRole: 'none',
          capability: 'creator',
        }
      : null,
  );
  const buildId = insertBuild(deps, source);
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, ids.main)).run();
  const app = createApp(deps);
  app.route(prefix, operatorRoutes);
  app.route('/api/v1/artifacts', artifacts);
  const path = `${prefix}/games/castle-game/builds/${buildId}/release`;
  expect((await app.request(path, { method: 'POST' })).status).toBe(401);
  const headers = { 'x-ogm-internal': INTERNAL_TOKEN };
  expect(
    (await app.request(`${prefix}/games/castle-game/builds/not-current/release`, { method: 'POST', headers })).status,
  ).toBe(409);
  expect((await app.request(path, { method: 'POST', headers })).status).toBe(200);
  expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBeTruthy();
  const authorize = async (grant?: string) =>
    (await (
      await app.request('/api/v1/artifacts/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: ids.game, buildId, ...(grant ? { grant } : {}) }),
      })
    ).json()) as { allowed: boolean };
  expect((await authorize()).allowed).toBe(false);
  const grantResponse = await app.request('/api/v1/artifacts/grant', {
    method: 'POST',
    headers: { cookie: 'session=owner', 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: ids.game, buildId }),
  });
  expect(grantResponse.status).toBe(200);
  const { grant } = (await grantResponse.json()) as { grant: string };
  expect((await authorize(grant)).allowed).toBe(true);
  deps.db.update(schema.games).set({ visibility: 'listed' }).where(eq(schema.games.id, ids.game)).run();
  expect((await authorize()).allowed).toBe(true);
  expect((await app.request(path, { method: 'POST', headers })).status).toBe(200);
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(1);
  unlinkSync(join(deps.config.gamesRoot, ids.game, buildId, 'index.html'));
  expect((await app.request(path, { method: 'POST', headers })).status).toBe(409);
  deps.db.update(schema.games).set({ delistedAt: new Date().toISOString() }).where(eq(schema.games.id, ids.game)).run();
  expect(await (await app.request(path, { method: 'POST', headers })).json()).toMatchObject({ error: 'game_delisted' });
});

it('leaves the current release unchanged when the rights check is unavailable', async () => {
  const { deps, source } = setup({
    checkRights: async () => {
      throw new Error('unavailable');
    },
  });
  const buildId = insertBuild(deps, source);
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, ids.main)).run();
  const app = createApp(deps);
  app.route(prefix, operatorRoutes);
  const response = await app.request(`${prefix}/games/castle-game/builds/${buildId}/release`, {
    method: 'POST',
    headers: { 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(response.status).toBe(500);
  expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBeNull();
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(0);
});

it('does not release an older build when main moves during the release gate', async () => {
  const { deps, source, runtime } = setup();
  const buildId = insertBuild(deps, source);
  const nextBuildId = insertBuild(deps, source, { id: ids.build2 });
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, ids.main)).run();
  runtime.commit.execute = async (op) => {
    if (op.kind === 'release')
      deps.db.update(schema.branches).set({ latestBuildId: nextBuildId }).where(eq(schema.branches.id, ids.main)).run();
    return { ok: true, sha: 'c'.repeat(40) };
  };
  const app = createApp(deps);
  app.route(prefix, operatorRoutes);
  const response = await app.request(`${prefix}/games/castle-game/builds/${buildId}/release`, {
    method: 'POST',
    headers: { 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(response.status).toBe(409);
  expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBeNull();
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(0);
});
