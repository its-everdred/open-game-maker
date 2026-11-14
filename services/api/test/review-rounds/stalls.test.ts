import { expect, it } from 'vitest';
import { schema } from '@ogm/db';

import { missingOpenRounds, reviewStalls } from '../../src/review-rounds/stalls.js';
import { answerRound, consumeRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('lists an overdue worker until a new round arrives, and never treats a reminder as a verdict', () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const first = {
    id: 'first',
    gameId: GAME,
    track: 'art',
    phase: 'concept',
    category: 'art' as const,
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-01-01T00:00:00Z',
  };
  postRound(deps.db, first);
  answerRound(deps.db, GAME, first.id, {
    verdict: 'needs_work',
    notes: 'fix it',
    source: 'preview',
    at: '2026-01-01T01:00:00Z',
  });
  consumeRound(deps.db, GAME, first.id, 'run-1', '2026-01-01T01:00:00Z');
  expect(reviewStalls(deps.db, Date.parse('2026-01-01T06:59:59Z')).worker).toHaveLength(0);
  expect(reviewStalls(deps.db, Date.parse('2026-01-01T07:00:00Z')).worker.map((row) => row.id)).toEqual(['first']);
  postRound(deps.db, { ...first, id: 'second', round: 2, postedAt: '2026-01-01T07:00:00Z' });
  expect(reviewStalls(deps.db, Date.parse('2026-01-02T07:00:00Z'))).toMatchObject({
    worker: [],
    creator: [{ id: 'second', verdict: null }],
  });
});

it('identifies a human-review owner who has not posted an open round', () => {
  const owner = { gameId: GAME, track: 'art', phase: 'concept', ticket: '42', status: 'human-review' };
  expect(missingOpenRounds([], [owner])).toEqual([owner]);
  expect(missingOpenRounds([], [{ ...owner, status: 'in-progress' }])).toEqual([]);
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'round',
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
  expect(missingOpenRounds(deps.db.select().from(schema.reviewRounds).all(), [owner])).toEqual([]);
});
