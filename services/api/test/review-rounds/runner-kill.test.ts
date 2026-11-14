import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import type { AiurClient } from '@ogm/aiur-client';
import { expect, it, vi } from 'vitest';
import { createReviewSync } from '../../src/review-rounds/runner.js';
import { answerRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

vi.mock('../../src/review-rounds/tracks.js', () => ({
  listTracks: async () => [{ id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '42', template: 'art' }] }],
  readTrack: async () => ({ id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '42', template: 'art' }] }),
}));

it('reconciles a creator kill verdict exactly once without filing a follow-up', async () => {
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
  postRound(deps.db, {
    id: 'r',
    gameId: GAME,
    track: 'art',
    phase: 'concept',
    category: 'art',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-01-01T00:00:00Z',
  });
  answerRound(deps.db, GAME, 'r', { verdict: 'kill', notes: null, source: 'command', at: '2026-01-01T01:00:00Z' });
  const issues = { ensureFollowup: vi.fn(), close: vi.fn(), cancel: vi.fn(), merged: vi.fn() };
  const client = { issue: async () => ({ status: 'idle', idle: { state: 'in-progress' } }) } as unknown as AiurClient;
  const sync = createReviewSync({ db: deps.db, issues, clientForGame: async () => client, log: () => {} });
  await sync();
  await sync();
  expect(issues.cancel).toHaveBeenCalledOnce();
  expect(issues.ensureFollowup).not.toHaveBeenCalled();
});
