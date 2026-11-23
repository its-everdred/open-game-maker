import { expect, it } from 'vitest';
import { postRound } from '../../src/review-rounds/store.js';
import roundRoutes from '../../src/review-rounds/routes.js';
import { asUser } from '../helpers.js';
import { ids, world } from '../builds/fixtures.js';

/* Kevin, #1281: a review card plays the reviewed slice in place, so a build that names its scenario carries the slice. */
it('links a published round to its build started in the reviewed scenario', async () => {
  const { deps, app } = world();
  app.route('/api/v1', roundRoutes);
  const post = (id: string, build: Record<string, string>, postedAt: string, round: number) =>
    postRound(deps.db, {
      id,
      gameId: ids.game,
      track: 'prototype-publish',
      phase: 'build',
      category: 'gameplay',
      round,
      ticket: 'publish',
      sha: 'e'.repeat(40),
      media: JSON.stringify([{ kind: 'build', ref: 'build_published', ...build }]),
      postedAt,
    });
  const read = async () => {
    const response = await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds`, {
      headers: asUser(ids.user),
    });
    return ((await response.json()) as { rounds: { playUrl: string | null; sliceUrl: string | null }[] }).rounds[0]!;
  };

  post('round-without-scenario', {}, '2026-11-20T00:00:00.000Z', 1);
  expect(await read()).toMatchObject({ sliceUrl: null });

  post('round-with-scenario', { scenario: 'town/lantern-dusk' }, '2026-11-21T00:00:00.000Z', 2);
  expect(await read()).toMatchObject({
    playUrl: `https://app.example.test/g/${ids.game}?mode=edit&build=build_published&scenario=town%2Flantern-dusk`,
    sliceUrl: `https://app.example.test/g/${ids.game}/play?build=build_published&scenario=town%2Flantern-dusk`,
  });
});
