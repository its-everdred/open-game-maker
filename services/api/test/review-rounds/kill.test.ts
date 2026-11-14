import { expect, it, vi } from 'vitest';
import { stopReview } from '../../src/review-rounds/kill.js';
import { answerRound, getRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('cancels a killed review once and never advances it', async () => {
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
  answerRound(deps.db, GAME, 'r', { verdict: 'kill', notes: null, source: 'command', at: '2026-01-01T01:00:00Z' });
  const track = { id: 'art', category: 'art' as const, phases: [{ id: 'concept', ticket: '42', template: 'art' }] };
  const issues = { cancel: vi.fn().mockResolvedValue(undefined) };
  const run = () =>
    stopReview(deps.db, getRound(deps.db, GAME, 'r')!, track, 'owner/repo', issues, '2026-01-01T02:00:00Z');
  await run();
  await run();
  expect(issues.cancel).toHaveBeenCalledOnce();
  expect(issues.cancel).toHaveBeenCalledWith('owner/repo', '42');
});
