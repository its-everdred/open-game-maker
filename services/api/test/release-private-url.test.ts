import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { expect, it } from 'vitest';
import { createApp } from '../src/app/app.js';
import { validGrant } from '../src/artifacts/grants.js';
import releaseRoutes from '../src/releases/routes.js';
import { publish } from '../src/releases/service.js';
import { ids, insertBuild, setup } from './release-fixtures.js';

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
