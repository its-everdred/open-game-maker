import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { createApp } from '../../src/app/app.js';
import { buildRoutes } from '../../src/builds/routes.js';
import { ids, REPO, SECRET, TICKET, world } from './fixtures.js';

it('resolves a persisted child ticket for its own game before accepting a build', async () => {
  const { deps } = world();
  deps.registry.ticketJobResolver = null;
  deps.db
    .update(schema.games)
    .set({ githubOwner: 'everdred-games', githubRepo: 'gm-g2' })
    .where(eq(schema.games.id, ids.game))
    .run();
  deps.db
    .insert(schema.jobTickets)
    .values({ jobId: ids.job, key: 'child', issueNumber: Number(TICKET), repo: REPO, sig: 'test' })
    .run();
  const app = createApp(deps);
  app.route(
    '/internal',
    buildRoutes({
      daemonForSecret: async (secret) => (secret === SECRET || secret === 'other' ? REPO : null),
      gameForSecret: async (secret) =>
        secret === SECRET ? { repo: REPO, slug: 'castle-game' } : { repo: REPO, slug: 'other-game' },
    }),
  );
  const request = (secret: string) =>
    app.request(`/internal/jobs/by-ticket/${TICKET}/build`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'x-gm-sha': 'invalid' },
      body: 'x',
    });
  expect((await request(SECRET)).status).toBe(400);
  expect((await request('other')).status).toBe(404);
});
