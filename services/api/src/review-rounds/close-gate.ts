import type { ReviewOwner } from './stalls.js';
import type { ReviewRound } from './store.js';

export function reviewApprovalsSettled(
  ticket: string,
  rounds: readonly ReviewRound[],
  intents: readonly { roundId: string; state: string }[],
  exceptRoundId?: string,
): boolean {
  return rounds.every(
    (round) =>
      round.ticket !== ticket ||
      round.verdict !== 'approved' ||
      round.id === exceptRoundId ||
      intents.some((intent) => intent.roundId === round.id && ['delivered', 'consumed'].includes(intent.state)),
  );
}

// A ticket may own more than one phase; every owned phase must have an approved latest round.
export function reviewAllowsClose(
  ticket: string,
  gameId: string,
  owners: readonly ReviewOwner[],
  rounds: readonly ReviewRound[],
): boolean {
  const owned = owners.filter((owner) => owner.gameId === gameId && owner.ticket === ticket);
  return owned.every((owner) => {
    const latest = rounds
      .filter(
        (round) =>
          round.gameId === gameId &&
          round.track === owner.track &&
          round.phase === owner.phase &&
          round.ticket === ticket,
      )
      .sort((a, b) => b.round - a.round)[0];
    return latest?.verdict === 'approved';
  });
}
