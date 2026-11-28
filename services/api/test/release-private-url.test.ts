import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { expect, it } from 'vitest';
import { createApp } from '../src/app/app.js';
import { validGrant } from '../src/artifacts/grants.js';
import releaseRoutes from '../src/releases/routes.js';
import { publish } from '../src/releases/service.js';
import { ids, insertBuild, now, setup } from './release-fixtures.js';

it.each([
  { visibility: 'private' as const, releaseState: 'released' as const },
  { visibility: 'listed' as const, releaseState: 'coming_soon' as const },
])('returns a session-scoped URL for a $visibility $releaseState release', async (settings) => {
  const { deps, source, runtime } = setup();
  const buildId = insertBuild(deps, source);
  deps.db.update(schema.games).set(settings).where(eq(schema.games.id, ids.game)).run();
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
  const release = await publish(deps, runtime, { gameId: ids.game, buildId, actor: ids.user });
  const app = createApp(deps);
  app.route('/', releaseRoutes);
  const response = await app.request(`/api/v1/games/${ids.game}/published`, {
    headers: { cookie: 'session=owner', 'if-none-match': `"${release.id}"` },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const { buildUrl } = (await response.json()) as { buildUrl: string };
  expect(buildUrl).toContain(`/d/${ids.game}/${buildId}/`);
  const grant = new URL(buildUrl).pathname.split('/')[4]!;
  expect(await validGrant(deps, grant, ids.game, buildId)).toBe(true);
});

it('returns a revocable private release URL to an invited player', async () => {
  const { deps, source, runtime } = setup();
  const buildId = insertBuild(deps, source);
  const player = 'u_00000000-0000-4000-8000-000000000088';
  deps.db
    .insert(schema.invitations)
    .values({
      id: 'invite_private',
      familyId: ids.family,
      kind: 'play',
      email: 'player@example.test',
      tokenHash: 'hash',
      gameId: ids.game,
      inviterId: ids.user,
      expiresAt: now,
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.gameGrants)
    .values({ gameId: ids.game, userId: player, sourceInviteId: 'invite_private' })
    .run();
  deps.registry.principalResolvers.push(async (c) =>
    c.req.header('cookie') === 'session=player'
      ? {
          kind: 'user',
          userId: player,
          familyId: 'f_other',
          displayName: 'Player',
          platformRole: 'none',
          capability: 'player',
        }
      : null,
  );
  await publish(deps, runtime, { gameId: ids.game, buildId, actor: ids.user });
  const app = createApp(deps);
  app.route('/', releaseRoutes);
  const response = await app.request(`/api/v1/games/${ids.game}/published`, { headers: { cookie: 'session=player' } });
  expect(response.status).toBe(200);
  const { buildUrl } = (await response.json()) as { buildUrl: string };
  const grant = new URL(buildUrl).pathname.split('/')[4]!;
  expect(await validGrant(deps, grant, ids.game, buildId)).toBe(true);
  deps.db.delete(schema.gameGrants).where(eq(schema.gameGrants.userId, player)).run();
  expect(await validGrant(deps, grant, ids.game, buildId)).toBe(false);
});
