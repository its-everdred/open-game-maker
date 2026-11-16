import { expect, it } from 'vitest';
import { makeDeps } from '../helpers.js';
import {
  markReviewAnswered,
  observeReviewState,
  retainReviewTickets,
  reviewAnswerPending,
} from '../../src/review-rounds/answer-guard.js';

it('persists a guard until the tracker observes the ticket leave review', () => {
  const { db } = makeDeps();
  markReviewAnswered(db, 'core', '12');
  markReviewAnswered(db, 'game', '12');
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  retainReviewTickets(db, 'core', new Set());
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  retainReviewTickets(db, 'core', new Set(['12']));
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  observeReviewState(db, 'core', '12', false);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
  expect(reviewAnswerPending(db, 'game', '12')).toBe(true);
});

it('releases only a guard from an earlier review episode', async () => {
  const { db } = makeDeps();
  const { reconcileReviewEpisode } = await import('../../src/review-rounds/answer-guard.js');
  markReviewAnswered(db, 'core', '12', '100');
  await reconcileReviewEpisode(db, 'core', '12', '100');
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  await reconcileReviewEpisode(db, 'core', '12', undefined);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  await reconcileReviewEpisode(db, 'core', '12', '101');
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
  markReviewAnswered(db, 'core', '12', null);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  await reconcileReviewEpisode(db, 'core', '12', '102@2999-01-01T00:00:00Z');
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
});
