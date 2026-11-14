import { schema, type Db } from '@ogm/db';

import type { ReviewRound } from './store.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// A later submission for the same phase ends a worker stall, regardless of that new round's verdict.
export function reviewStalls(db: Db, now: number): { worker: ReviewRound[]; creator: ReviewRound[] } {
  const rounds = db.select().from(schema.reviewRounds).all();
  const latest = new Map<string, number>();
  for (const round of rounds) {
    const key = JSON.stringify([round.gameId, round.track, round.phase]);
    latest.set(key, Math.max(latest.get(key) ?? 0, round.round));
  }
  return {
    worker: rounds.filter((round) => {
      const key = JSON.stringify([round.gameId, round.track, round.phase]);
      return (
        round.verdict === 'needs_work' &&
        round.consumedAt !== null &&
        now - Date.parse(round.consumedAt) >= SIX_HOURS &&
        latest.get(key) === round.round
      );
    }),
    creator: rounds.filter(
      (round) => round.verdict === null && round.remindedAt === null && now - Date.parse(round.postedAt) >= DAY,
    ),
  };
}

export type ReviewOwner = { gameId: string; track: string; phase: string; ticket: string; status: string };

// A finished worker turn in review must leave an unanswered round for its own phase.
export function missingOpenRounds(rounds: readonly ReviewRound[], owners: readonly ReviewOwner[]): ReviewOwner[] {
  return owners.filter(
    (owner) =>
      owner.status === 'human-review' &&
      !rounds.some(
        (round) =>
          round.gameId === owner.gameId &&
          round.track === owner.track &&
          round.phase === owner.phase &&
          round.ticket === owner.ticket &&
          round.verdict === null,
      ),
  );
}
