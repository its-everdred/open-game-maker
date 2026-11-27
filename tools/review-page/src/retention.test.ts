import { describe, expect, it } from 'vitest';

import { keepReviewCard } from './retention.js';

describe('review card retention', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');

  it('keeps unanswered cards and answers at or within ten minutes', () => {
    expect(keepReviewCard(undefined, now)).toBe(true);
    expect(keepReviewCard(now - 600_000, now)).toBe(true);
    expect(keepReviewCard(now - 1_000, now)).toBe(true);
  });

  it('removes answers older than ten minutes on the next build', () => {
    expect(keepReviewCard(now - 600_001, now)).toBe(false);
  });

  it('retains a card if its answer timestamp cannot be parsed', () => {
    expect(keepReviewCard(Number.NaN, now)).toBe(true);
  });
});
