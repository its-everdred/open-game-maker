import { expect, it, vi } from 'vitest';
import type { AiurClient } from '@ogm/aiur-client';
import { createReviewSync } from '../../src/review-rounds/runner.js';
import { answerRound, getRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('dispatches a needs-work verdict once and records the worker session after its queue drains', async () => {
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
  answerRound(deps.db, GAME, 'round', {
    verdict: 'needs_work',
    notes: '  Fix it\nexactly.  ',
    source: 'preview',
    at: '2026-01-01T01:00:00Z',
  });
  let message: string | null = null;
  const rework = vi.fn(async (_ticket: string, reason: string) => {
    message = reason;
  });
  const client = {
    rework,
    ticketTranscript: async () => ({ events: message ? [{ body: message, turn_id: null }] : [], nextCursor: null }),
    issue: async () =>
      message
        ? {
            status: 'running',
            running: { session_id: 'run-1', started_at: '2026-01-01T01:00:01Z' },
            queue: { depth: 0 },
          }
        : { status: 'idle', running: null, queue: { depth: 0 } },
  } as unknown as AiurClient;
  const sync = createReviewSync({
    db: deps.db,
    clientForGame: async () => client,
    log: () => {},
    now: () => Date.parse('2026-01-01T01:01:00Z'),
  });
  await sync();
  await sync();
  expect(rework).toHaveBeenCalledOnce();
  expect(message).toBe('<!-- gm-review-verdict:round -->\n  Fix it\nexactly.  \n<!-- gm-review-end -->');
  expect(getRound(deps.db, GAME, 'round')?.consumedByRun).toBe('run-1');
});
