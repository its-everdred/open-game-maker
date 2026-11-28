import { expect, it } from 'vitest';
import { createApp } from '../../src/app/app.js';
import { buildRoutes } from '../../src/builds/routes.js';
import { ids, REPO, SECRET, SHA, TICKET, world } from './fixtures.js';
import { schema } from '@ogm/db';

it('binds shared-repository jobs to their registered daemon', async () => {
  const { deps } = world();
  deps.sqlite
    .prepare('UPDATE games SET github_owner = ?, github_repo = ? WHERE id = ?')
    .run('everdred-games', 'gm-g2', ids.game);
  const addDaemon = (slug: string, port: number) =>
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug,
        repo: REPO,
        checkoutPath: '/fixture',
        unit: 'fixture',
        envFile: '/fixture.env',
        port,
        status: 'running',
        createdAt: '2026-11-01T00:00:00Z',
      })
      .run();
  addDaemon('shared-game', 4101);
  const make = (slug: string) => {
    const app = createApp(deps);
    app.route(
      '/internal',
      buildRoutes({
        daemonForSecret: async (secret) => (secret === SECRET ? REPO : null),
        gameForSecret: async (secret) => (secret === SECRET ? { repo: REPO, slug } : null),
      }),
    );
    return app;
  };
  const request = (slug: string) =>
    make(slug).request(`/internal/jobs/by-ticket/${TICKET}/publish-context`, {
      headers: { authorization: `Bearer ${SECRET}`, 'x-gm-sha': SHA },
    });
  expect((await request('other-game')).status).toBe(404);
  const allowed = await request('shared-game');
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toEqual({ path: 'games/castle-game', visibility: 'private' });
  addDaemon('castle-game', 4102);
  expect((await request('shared-game')).status).toBe(404);
  expect((await request('castle-game')).status).toBe(200);
});
