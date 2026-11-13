import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app/app.js';
import { appendTransaction, ensureMainBranch } from '../../src/design/store.js';
import { agentDesignRoutes } from '../../src/internal/agent-design.js';
import { ids, insertJob } from '../budget/fixture.js';
import { makeDeps } from '../helpers.js';

describe('agent design snapshot', () => {
  it('returns the current game design only to its own daemon and ticket', async () => {
    const deps = makeDeps();
    const now = new Date('2026-11-01T00:00:00Z');
    deps.db
      .insert(schema.families)
      .values({ id: ids.family, name: 'F', ownerUserId: ids.creator, createdAt: now.toISOString() })
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: ids.game,
        familyId: ids.family,
        ownerId: ids.creator,
        slug: 'castle',
        title: 'Castle',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: now.toISOString(),
      })
      .run();
    insertJob(deps, { id: ids.running });
    const branch = ensureMainBranch(deps.sqlite, ids.game, { now });
    appendTransaction(
      deps.sqlite,
      {
        gameId: ids.game,
        branchId: branch.id,
        baseRev: 0,
        leaseToken: 0,
        actor: ids.creator,
        kind: 'system',
        label: 'Scenery',
        baseBuildId: 'build_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        commands: [],
        patches: [{ op: 'add', path: ['globals', 'scenery'], value: { version: 1 } }],
        inverse: [{ op: 'remove', path: ['globals', 'scenery'] }],
      },
      { now },
    );
    deps.registry.ticketJobResolver = async (repo, ticket) =>
      repo === 'instance/games' && ticket === '12'
        ? {
            jobId: ids.running,
            gameId: ids.game,
            repo,
            kind: 'feature',
            game: { title: 'Castle', family: 'any', pov: 'iso', genre: 'adventure', multiplayer: false },
          }
        : null;
    const app = createApp(deps);
    app.route(
      '/internal',
      agentDesignRoutes({
        identityForSecret: async (secret) =>
          secret === 'own'
            ? { repo: 'instance/games', slug: 'castle' }
            : secret === 'other'
              ? { repo: 'instance/games', slug: 'other' }
              : null,
      }),
    );
    const get = (secret?: string) =>
      app.request(
        'http://127.0.0.1/internal/jobs/by-ticket/12/design',
        secret ? { headers: { authorization: `Bearer ${secret}` } } : {},
      );
    expect((await get()).status).toBe(401);
    expect((await get('other')).status).toBe(404);
    const response = await get('own');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      rev: 1,
      buildId: null,
      doc: { globals: { scenery: { version: 1 } } },
    });
  });
});
