import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { expect, it } from 'vitest';

import { INTERNAL_TOKEN, installUsers, makeApp, makeDeps } from '../helpers.js';

const now = '2026-11-01T00:00:00.000Z';

// The post-deploy cards check can only catch a vanishing logo on a card it can see: the QA account's own list has
// none of the creators' games, so this route hands it every game's real card media (#1312).
it('lists every game but QA and delisted ones with its card media, only for the internal token', async () => {
  const deps = makeDeps();
  const { app } = await makeApp(deps);
  installUsers(deps, [
    {
      kind: 'user',
      userId: 'u1',
      displayName: 'Creator',
      email: 'creator@example.com',
      familyId: 'f1',
      platformRole: 'none',
      capability: 'creator',
    },
  ]);
  deps.db.insert(schema.families).values({ id: 'f1', name: 'Family', ownerUserId: 'u1', createdAt: now }).run();
  const game = (id: string, slug: string | null, extra: Partial<typeof schema.games.$inferInsert> = {}) =>
    deps.db
      .insert(schema.games)
      .values({
        id,
        familyId: 'f1',
        ownerId: 'u1',
        title: id,
        slug,
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: now,
        ...extra,
      })
      .run();
  game('g_art', 'art');
  game('g_plain', null);
  game('g_qa', 'qa-review');
  game('g_gone', 'gone', { delistedAt: now });
  deps.db
    .insert(schema.branches)
    .values({
      id: 'b1',
      gameId: 'g_art',
      name: 'main',
      gitRef: 'main',
      latestBuildId: 'build1',
      status: 'active',
      createdBy: 'u1',
      createdAt: now,
    })
    .run();
  const build = join(deps.config.gamesRoot, 'g_art', 'build1');
  mkdirSync(join(build, 'media'), { recursive: true });
  for (const file of ['thumbnail.png', 'logo.png']) writeFileSync(join(build, 'media', file), file);
  writeFileSync(join(build, 'manifest.json'), JSON.stringify({ logo: 'media/logo.png' }));
  writeFileSync(join(build, '.complete'), '');

  expect((await app.request('/internal/qa/cards')).status).toBe(401);
  const response = await app.request('/internal/qa/cards', { headers: { 'x-ogm-internal': INTERNAL_TOKEN } });
  expect(response.headers.get('cache-control')).toBe('no-store');
  const { games } = (await response.json()) as { games: Array<Record<string, unknown>> };
  expect(games.map((item) => item.id).sort()).toEqual(['g_art', 'g_plain']);
  expect(games.find((item) => item.id === 'g_art')).toMatchObject({
    title: 'g_art',
    coverUrl: 'https://games.example.test/g/g_art/build1/media/thumbnail.png',
    logoUrl: 'https://games.example.test/g/g_art/build1/media/logo.png',
  });
});
