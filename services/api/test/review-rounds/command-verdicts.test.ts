import { expect, it } from 'vitest';
import type { AiurClient, Decision } from '@ogm/aiur-client';
import { decisionKeyMarker } from '@ogm/contracts';
import { syncCommandVerdicts } from '../../src/review-rounds/command-verdicts.js';
import { getRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, OWNER, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('accepts only the game owner’s keyed verdict and preserves their notes', async () => {
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
  const decision = {
    ticket: { identifier: '42' },
    created_at: '2026-01-01T00:01:00Z',
    context: { long_context_markdown: decisionKeyMarker('round') },
    answer: {
      selected_option_id: 'needs_work',
      custom_response: '  Fix this.  ',
      actor: { kind: 'operator', id: 'someone-else' },
    },
  } as unknown as Decision;
  const client = { decisions: async () => [decision] } as unknown as AiurClient;
  const sync = () =>
    syncCommandVerdicts(
      deps.db,
      async () => client,
      () => '2026-01-01T01:00:00Z',
      () => {},
    );
  await sync();
  expect(getRound(deps.db, GAME, 'round')?.verdict).toBeNull();
  (decision.answer as unknown as { actor: { id: string } }).actor.id = OWNER;
  await sync();
  expect(getRound(deps.db, GAME, 'round')).toMatchObject({
    verdict: 'needs_work',
    notes: '  Fix this.  ',
    verdictSource: 'command',
  });
});
