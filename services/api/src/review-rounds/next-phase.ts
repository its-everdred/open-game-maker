import type { ReviewRound } from './store.js';

// The marker lets a retry find a ticket that GitHub created before the response was lost.
export function nextPhaseMarker(round: Pick<ReviewRound, 'gameId' | 'track' | 'phase'>): string {
  return `<!-- gm-review-next:${JSON.stringify([round.gameId, round.track, round.phase])} -->`;
}

export function nextPhaseTicket(round: ReviewRound): { title: string; body: string } {
  if (round.verdict !== 'approved') throw new Error('review_round_not_approved');
  const approval = `Approved review round: ${round.id}\nTrack: ${round.track}\nPhase: ${round.phase}`;
  const scope =
    round.category === 'art'
      ? {
          title: 'Convert approved art into an asset pack',
          body: 'Convert the approved concept into an in-game asset pack, retaining the approved round as the reference.',
        }
      : round.category === 'gameplay'
        ? {
            title: 'Implement approved gameplay and publish a preview',
            body: 'Implement the approved gameplay and publish a playable preview. The first review round must include a gm preview build and one design question.',
          }
        : {
            title: 'Integrate approved sound',
            body: 'Integrate the approved sound with the event it was reviewed against.',
          };
  return { title: scope.title, body: `${nextPhaseMarker(round)}\n${approval}\n\n${scope.body}` };
}
