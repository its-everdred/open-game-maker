import { beforeEach, expect, it } from 'vitest';
import { notifyState, pushUpdate, readUpdates, setUpdateOwner } from './slice';

beforeEach(() => {
  setUpdateOwner(undefined);
  setUpdateOwner('creator');
});

// Kevin's Builds panel (2026-11-21) listed "Reviews are ready — New items are waiting for your review." five times:
// one line per review.ready batch, all identical, each adding to the badge.
it('shows a repeated notice once and counts it once while unread', () => {
  pushUpdate('Build done');
  for (let i = 0; i < 5; i += 1) pushUpdate('Reviews are ready — New items are waiting for your review.');
  expect(notifyState().updates.map((update) => update.text)).toEqual([
    'Build done',
    'Reviews are ready — New items are waiting for your review.',
  ]);
  expect(notifyState().unreadUpdates).toBe(2);
});

it('counts a repeat that arrives after the creator read the first one', () => {
  pushUpdate('Reviews are ready — New items are waiting for your review.');
  readUpdates();
  pushUpdate('Reviews are ready — New items are waiting for your review.');
  expect(notifyState().updates).toHaveLength(1);
  expect(notifyState().unreadUpdates).toBe(1);
});
