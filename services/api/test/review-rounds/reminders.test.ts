import { expect, it } from 'vitest';
import { queueReviewReminders } from '../../src/review-rounds/reminders.js';
import { getRound, postRound } from '../../src/review-rounds/store.js';
import { listNotifications } from '../../src/notify/store.js';
import { GAME, OWNER, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('queues one durable reminder after a day without recording a verdict', () => {
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
  expect(queueReviewReminders(deps.db, deps.sqlite, Date.parse('2026-01-01T23:59:59Z'))).toEqual([]);
  expect(queueReviewReminders(deps.db, deps.sqlite, Date.parse('2026-01-02T00:00:00Z'))).toHaveLength(1);
  expect(queueReviewReminders(deps.db, deps.sqlite, Date.parse('2026-01-03T00:00:00Z'))).toEqual([]);
  expect(listNotifications(deps.sqlite, OWNER, {})).toMatchObject([
    { kind: 'review.reminder', data: { roundId: 'round' } },
  ]);
  expect(getRound(deps.db, GAME, 'round')?.verdict).toBeNull();
});

it('does not acknowledge a reminder if its inbox write fails', () => {
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
  deps.sqlite.exec('DROP TABLE notifications');
  expect(() => queueReviewReminders(deps.db, deps.sqlite, Date.parse('2026-01-02T00:00:00Z'))).toThrow();
  expect(getRound(deps.db, GAME, 'round')?.remindedAt).toBeNull();
});
