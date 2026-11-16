import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import type { AiurClient } from '@ogm/aiur-client';
import { expect, it, vi } from 'vitest';
import { createReviewSync } from '../../src/review-rounds/runner.js';
import { answerRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

vi.mock('../../src/review-rounds/tracks.js', () => ({
  listTracks: async () => [
    {
      id: 'art',
      category: 'art',
      phases: [
        { id: 'mock', ticket: '42', template: 'mock' },
        { id: 'build', template: 'integrate approved art' },
      ],
    },
  ],
}));

it('reconciles the two-rung track on one issue without any thread operation', async () => {
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
      createdAt: '2026-01-01',
    })
    .run();
  const labels = ['phase:mock', 'model:low'];
  const issues = {
    ensureFollowup: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    merged: vi.fn(),
    integrated: vi.fn(),
    setFidelity: vi.fn(async (_repo: string, ticket: string, phase: string, effort: string) => {
      expect(ticket).toBe('42');
      labels.splice(0, labels.length, `phase:${phase}`, `model:${effort}`);
    }),
  };
  let message = '';
  const client = {
    rework: vi.fn(async (_ticket: string, body: string) => {
      message = body;
    }),
    ticketTranscript: async () => ({ events: message ? [{ body: message, turn_id: 'run-1' }] : [], nextCursor: null }),
    issue: async () => ({ status: 'idle', idle: { state: 'in-progress' }, queue: { depth: 0 } }),
  } as unknown as AiurClient;
  const log = vi.fn();
  const sync = createReviewSync({ db: deps.db, issues, clientForGame: async () => client, log });
  const add = (id: string, phase: string, effort: 'low' | 'xhigh') => {
    postRound(deps.db, {
      id,
      gameId: GAME,
      track: 'art',
      phase,
      effort,
      category: 'art',
      round: 1,
      ticket: '42',
      sha: 'a'.repeat(40),
      media: '[]',
      postedAt: '2026-01-01',
    });
    answerRound(deps.db, GAME, id, { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  };
  add('first', 'mock', 'low');
  await sync();
  expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'review_round_sync_error' }));
  expect(labels).toEqual(['phase:build', 'model:xhigh']);
  expect(issues.ensureFollowup).not.toHaveBeenCalled();
  expect(issues.close).not.toHaveBeenCalled();
  expect(message).toContain('integrate approved art');
  add('last', 'build', 'xhigh');
  await sync();
  expect(issues.close).toHaveBeenCalledWith('owner/repo', '42');
});
