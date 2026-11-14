import { expect, it, vi } from 'vitest';
import { schema } from '@ogm/db';
import { dispatchRework, reworkMarker } from '../../src/review-rounds/rework.js';
import { answerRound, getRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('persists intent before dispatch and finds the marker after an indeterminate call', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'round-1',
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
  answerRound(deps.db, GAME, 'round-1', {
    verdict: 'needs_work',
    notes: '  Please fix\nthis.  ',
    source: 'preview',
    at: '2026-01-01T01:00:00Z',
  });
  const round = getRound(deps.db, GAME, 'round-1')!;
  let queued = false;
  const findMarker = vi.fn(async () => (queued ? { runId: 'run-1' } : null));
  const rework = vi.fn(async (_ticket: string, reason: string) => {
    expect(deps.db.select().from(schema.reviewDispatchIntents).get()).toMatchObject({
      roundId: 'round-1',
      ticket: '42',
      state: 'dispatching',
    });
    expect(reason).toBe(`${reworkMarker('round-1')}\n  Please fix\nthis.  \n<!-- gm-review-end -->`);
    queued = true;
    throw new Error('response lost');
  });
  const delivery = { findMarker, rework };
  const now = () => '2026-01-01T02:00:00Z';
  await expect(dispatchRework(deps.db, round, delivery, now)).rejects.toThrow('response lost');
  expect(await dispatchRework(deps.db, round, delivery, now)).toBe('consumed');
  expect(await dispatchRework(deps.db, round, delivery, now)).toBe('consumed');
  expect(rework).toHaveBeenCalledTimes(1);
  expect(getRound(deps.db, GAME, 'round-1')?.consumedByRun).toBe('run-1');
});

it('does not dispatch if marker lookup fails', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'r',
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
  answerRound(deps.db, GAME, 'r', {
    verdict: 'needs_work',
    notes: null,
    source: 'preview',
    at: '2026-01-01T01:00:00Z',
  });
  const rework = vi.fn();
  await expect(
    dispatchRework(
      deps.db,
      getRound(deps.db, GAME, 'r')!,
      { rework, findMarker: vi.fn().mockRejectedValue(new Error('offline')) },
      () => 'now',
    ),
  ).rejects.toThrow('offline');
  expect(rework).not.toHaveBeenCalled();
});
