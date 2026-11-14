import { expect, it } from 'vitest';
import { reviewAllowsClose } from '../../src/review-rounds/close-gate.js';
import type { ReviewRound } from '../../src/review-rounds/store.js';

it('only permits a track owner to close after its latest phase round is approved', () => {
  const owner = { gameId: 'g', track: 'art', phase: 'concept', ticket: '42', status: 'human-review' };
  const round = {
    gameId: 'g',
    track: 'art',
    phase: 'concept',
    ticket: '42',
    round: 1,
    verdict: 'approved',
  } as ReviewRound;
  expect(reviewAllowsClose('42', 'g', [owner], [])).toBe(false);
  expect(reviewAllowsClose('42', 'g', [owner], [round])).toBe(true);
  expect(reviewAllowsClose('42', 'g', [owner], [round, { ...round, round: 2, verdict: 'needs_work' }])).toBe(false);
  expect(reviewAllowsClose('43', 'g', [owner], [])).toBe(true);
});
