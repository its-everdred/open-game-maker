import { createHash } from 'node:crypto';

export const PLANNER_TICKET_KEY = 'new-game-plan';

/** Render only public identifiers; the worker must obtain private context through the internal API. */
export function plannerIssue(input: { jobId: string; parentNumber: number; gameSlug: string; ticketLimit: number }): {
  title: string;
  body: string;
  sig: string;
  labels: string[];
} {
  if (!Number.isSafeInteger(input.ticketLimit) || input.ticketLimit < 1) {
    throw new RangeError('planner ticket limit must be a positive integer');
  }
  const unsigned = [
    `Plan the New Game request in #${input.parentNumber} using gm-new-game-plan in automated tester planning mode.`,
    `Private context reference: ${input.jobId}`,
    `Game: ${input.gameSlug}`,
    `Maximum child tickets for this game: ${input.ticketLimit}`,
    'Retrieve the private context through the authorised internal API; do not copy it into public issues.',
    '## Creator decisions\nnone',
  ].join('\n\n');
  const sig = createHash('sha256').update(unsigned).digest('hex');
  return {
    title: `Plan ${input.gameSlug}`,
    body: `${unsigned}\n\n<!-- gm-job:${input.jobId} gm-ticket:${PLANNER_TICKET_KEY} gm-sig:${sig} -->`,
    sig,
    labels: [`feature:gm-${input.jobId}`, `game:${input.gameSlug}`, 'role:game-design', 'model:high', 'priority:1'],
  };
}
