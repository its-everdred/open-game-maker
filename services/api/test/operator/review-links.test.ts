import { describe, expect, it } from 'vitest';

import operatorRoutes, { prefix as operatorPrefix } from '../../src/operator/routes.js';
import { reviewNumbers } from '../../src/reviews/numbers.js';
import { ids, world } from '../builds/fixtures.js';
import { INTERNAL_TOKEN } from '../helpers.js';

// The Executor's link builder (#591): it asks for one decision's short link and pushes it to the creator's phone, so
// the path must be the short form and must keep pointing at the same decision however often it is asked for.
function operator() {
  const fixture = world();
  fixture.app.route(operatorPrefix, operatorRoutes);
  return fixture;
}

function link(app: ReturnType<typeof operator>['app'], ref: string, decisionId: string, token = INTERNAL_TOKEN) {
  return app.request(`${operatorPrefix}/games/${ref}/reviews/${decisionId}`, { headers: { 'x-ogm-internal': token } });
}

describe('operator review links', () => {
  it('builds /<slug>/review/<n>, numbering decisions in the order they are first asked for', async () => {
    const { app } = operator();

    const first = await link(app, 'castle-game', 'd_first');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ number: 1, path: '/castle-game/review/1' });
    expect(await (await link(app, ids.game, 'd_second')).json()).toEqual({ number: 2, path: '/castle-game/review/2' });
    expect(await (await link(app, 'castle-game', 'd_first')).json()).toEqual({
      number: 1,
      path: '/castle-game/review/1',
    });
  });

  it('shares its numbers with the inbox, so the link and the inbox agree', async () => {
    const { app, deps } = operator();
    reviewNumbers(deps.db, ids.game, ['d_inbox']);

    expect(await (await link(app, 'castle-game', 'd_pushed')).json()).toEqual({
      number: 2,
      path: '/castle-game/review/2',
    });
  });

  it('refuses a caller without the internal token and an unknown game', async () => {
    const { app } = operator();
    expect((await link(app, 'castle-game', 'd_first', 'wrong')).status).toBe(401);
    expect((await link(app, 'nope', 'd_first')).status).toBe(404);
  });
});
