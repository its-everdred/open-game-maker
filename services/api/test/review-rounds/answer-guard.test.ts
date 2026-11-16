import { expect, it } from 'vitest';
import { makeDeps } from '../helpers.js';
import {
  markReviewAnswered,
  reconcileReviewEpisode,
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
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  observeReviewState(db, 'core', '12', true);
  observeReviewState(db, 'core', '12', false);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
});

it('binds a round episode only if its guard was not replaced', async () => {
  const { db } = makeDeps();
  const { bindReviewEpisode } = await import('../../src/review-rounds/answer-guard.js');
  const first = markReviewAnswered(db, 'core', '12');
  markReviewAnswered(db, 'core', '12', '200@2026-01-01T00:00:00Z');
  bindReviewEpisode(db, 'core', '12', first, '100@2026-01-01T00:00:00Z');
  const { reconcileReviewEpisode } = await import('../../src/review-rounds/answer-guard.js');
  await reconcileReviewEpisode(db, 'core', '12', '200@2026-01-01T00:00:00Z');
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
});

it('clears an in-progress answer guard once tracker history confirms no review episode', async () => {
  const { db } = makeDeps();
  const { bindReviewEpisode } = await import('../../src/review-rounds/answer-guard.js');
  const pending = markReviewAnswered(db, 'core', '12');
  bindReviewEpisode(db, 'core', '12', pending, undefined);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  bindReviewEpisode(db, 'core', '12', pending, null);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
});

it('keeps each simultaneous answer guarded until it finishes', async () => {
  const { db } = makeDeps();
  const { beginReviewAnswer, bindReviewEpisode } = await import('../../src/review-rounds/answer-guard.js');
  const first = beginReviewAnswer(db, 'core', '12');
  const second = beginReviewAnswer(db, 'core', '12');
  bindReviewEpisode(db, 'core', '12', first, null);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(true);
  bindReviewEpisode(db, 'core', '12', second, null);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
});

it('reuses the same in-flight guard for an idempotent retry', async () => {
  const { db } = makeDeps();
  const { beginReviewAnswer, bindReviewEpisode } = await import('../../src/review-rounds/answer-guard.js');
  const first = beginReviewAnswer(db, 'core', '12', 'decision:2');
  const retry = beginReviewAnswer(db, 'core', '12', 'decision:2');
  expect(retry).toBe(first);
  bindReviewEpisode(db, 'core', '12', retry, null);
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
});

it('reconciles an accepted command after its response was lost', async () => {
  const { db } = makeDeps();
  const { beginReviewAnswer, reconcilePendingCommands } = await import('../../src/review-rounds/answer-guard.js');
  beginReviewAnswer(db, 'core', '12', 'command:decision-id:2');
  const client = {
    decision: async () => ({ answer: { option_id: 'yes' } }),
  } as unknown as import('@ogm/aiur-client').AiurClient;
  await reconcilePendingCommands(db, 'core', '12', '200@2026-01-01T00:00:00Z', client);
  expect(
    db
      .select()
      .from((await import('@ogm/db')).schema.reviewAnswerGuards)
      .all(),
  ).toEqual([expect.objectContaining({ source: 'core', ticket: '12', episode: '200@2026-01-01T00:00:00Z' })]);
  await reconcileReviewEpisode(db, 'core', '12', '201@2026-01-02T00:00:00Z');
  expect(reviewAnswerPending(db, 'core', '12')).toBe(false);
});

it('reconciles an answered preview after its response was lost', async () => {
  const { db } = makeDeps();
  const { beginReviewAnswer, reconcilePendingPreviews } = await import('../../src/review-rounds/answer-guard.js');
  beginReviewAnswer(db, 'game', '12', 'preview:build-id');
  reconcilePendingPreviews(db, 'game', '12', '200@2026-01-01T00:00:00Z', new Set());
  expect(
    db
      .select()
      .from((await import('@ogm/db')).schema.reviewAnswerGuards)
      .all()[0]?.ticket,
  ).toContain('/pending@');
  reconcilePendingPreviews(db, 'game', '12', '200@2026-01-01T00:00:00Z', new Set(['build-id']));
  expect(
    db
      .select()
      .from((await import('@ogm/db')).schema.reviewAnswerGuards)
      .all(),
  ).toEqual([expect.objectContaining({ source: 'game', ticket: '12', episode: '200@2026-01-01T00:00:00Z' })]);
});
