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
  retainReviewTickets(db, 'core', new Set(['12']));
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  observeReviewState(db, 'core', '12', false);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
  expect(reviewAnswerPending(db, 'game', '12')).toBe(true);
});
