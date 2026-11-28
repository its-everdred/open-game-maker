import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import type { AiurClient } from '@ogm/aiur-client';
import { expect, it, vi } from 'vitest';
import { createReviewSync } from '../../src/review-rounds/runner.js';
import { answerRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

vi.mock('../../src/previews/live-workspace.js', () => ({ grantedLiveWorkspace: async () => '/granted-workspace' }));
vi.mock('../../src/review-rounds/tracks.js', () => ({
  reviewCheckout: async (root: string) => root,
  listTracks: async (root: string) => {
    if (root !== '/granted-workspace') throw new Error('wrong workspace');
    return [{ id: 'art', category: 'art', phases: [{ id: 'concept', ticket: '42', template: 'art' }] }];
  },
}));

it('reconciles a live verdict without a registered daemon', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  deps.db
    .update(schema.games)
    .set({ slug: 'fixture', githubPath: 'games/fixture', githubOwner: 'owner', githubRepo: 'repo' })
    .where(eq(schema.games.id, GAME))
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
    media: JSON.stringify([{ kind: 'build', ref: 'live-r' }]),
    postedAt: '2026-01-01T00:00:00Z',
  });
  answerRound(deps.db, GAME, 'r', { verdict: 'kill', notes: null, source: 'command', at: '2026-01-01T01:00:00Z' });
  const issues = {
    legacyStarted: vi.fn(),
    integrated: vi.fn(),
    setFidelity: vi.fn(),
    ensureFollowup: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    merged: vi.fn(),
  };
  const client = { issue: async () => ({ status: 'idle', idle: { state: 'in-progress' } }) } as unknown as AiurClient;
  const log = vi.fn();
  await createReviewSync({ db: deps.db, issues, clientForGame: async () => client, log })();
  expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'review_round_sync_error' }));
  expect(issues.cancel).toHaveBeenCalledOnce();
});
