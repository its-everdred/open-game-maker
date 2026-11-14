import type { ReviewRound } from './store.js';

// The marker lets a retry find a ticket that GitHub created before the response was lost.
export function nextPhaseMarker(round: Pick<ReviewRound, 'gameId' | 'track' | 'phase'>): string {
  return `<!-- gm-review-next:${JSON.stringify([round.gameId, round.track, round.phase])} -->`;
}

export function nextPhaseTicket(round: ReviewRound): { title: string; body: string } {
  if (round.verdict !== 'approved') throw new Error('review_round_not_approved');
  const media = (JSON.parse(round.media) as { kind: string; ref: string }[]).filter(
    (item) =>
      /^sha256:[a-f0-9]{64}$/u.test(item.ref) || (item.kind === 'build' && /^[A-Za-z0-9_-]{1,200}$/u.test(item.ref)),
  );
  const approval = `Approved review round: ${round.id}\nTrack: ${round.track}\nPhase: ${round.phase}\nApproved commit: ${round.sha}${round.prNumber === null ? '' : `\nReview PR: #${round.prNumber}`}\nApproved media: ${JSON.stringify(media)}`;
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
