import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import type { AiurClient } from '@ogm/aiur-client';
import { expect, it, vi } from 'vitest';
import { createReviewSync } from '../../src/review-rounds/runner.js';
import { answerRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

vi.mock('../../src/review-rounds/tracks.js', () => ({
  listTracks: async (_checkout: string, _path: string, sha?: string) => [
    { id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '42', template: 'art' }] },
    ...(sha?.startsWith('a')
      ? []
      : [{ id: 'sound', category: 'sound', phases: [{ id: 'cue', ticket: '42', template: 'sound' }] }]),
  ],
}));

it('does not close a shared ticket until every committed first phase is approved', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  deps.db
    .update(schema.games)
    .set({ slug: 'fixture', githubPath: 'games/fixture', githubOwner: 'owner', githubRepo: 'repo' })
    .where(eq(schema.games.id, GAME))
    .run();
  deps.db
    .insert(schema.gameDaemons)
    .values({
      slug: 'fixture',
      repo: 'owner/repo',
      checkoutPath: '/fixture',
      unit: 'fixture',
      envFile: '/fixture',
      port: 23456,
      status: 'running',
      createdAt: '2026-01-01T00:00:00Z',
    })
    .run();
  const add = (id: string, track: string, phase: string, category: 'art' | 'sound') => {
    postRound(deps.db, {
      id,
      gameId: GAME,
      track,
      phase,
      category,
      round: 1,
      ticket: '42',
      sha: (track === 'sound' ? 'b' : 'a').repeat(40),
      media: '[]',
      postedAt: '2026-01-01T00:00:00Z',
    });
    answerRound(deps.db, GAME, id, { verdict: 'approved', notes: null, source: 'command', at: '2026-01-01T01:00:00Z' });
  };
  const issues = { ensureFollowup: vi.fn(), close: vi.fn(), cancel: vi.fn(), merged: vi.fn(), integrated: vi.fn() };
  const client = { issue: async () => ({ status: 'idle', idle: { state: 'in-progress' } }) } as unknown as AiurClient;
  const sync = createReviewSync({ db: deps.db, issues, clientForGame: async () => client, log: () => {} });
  add('art-round', 'art', 'concept', 'art');
  await sync();
  expect(issues.close).not.toHaveBeenCalled();
  add('sound-round', 'sound', 'cue', 'sound');
  await sync();
  expect(issues.close).toHaveBeenCalledOnce();
});
