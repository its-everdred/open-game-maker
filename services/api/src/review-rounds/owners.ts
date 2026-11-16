import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';
import type { ReviewTrack } from '@ogm/contracts';
import type { ReviewRound } from './store.js';

export function otherPhaseInProgress(db: Db, round: ReviewRound): boolean {
  const owners = db
    .select()
    .from(schema.reviewPhaseOwners)
    .where(eq(schema.reviewPhaseOwners.gameId, round.gameId))
    .all();
  const rounds = db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.gameId, round.gameId)).all();
  const intents = db
    .select()
    .from(schema.reviewDispatchIntents)
    .where(eq(schema.reviewDispatchIntents.ticket, round.ticket))
    .all();
  const activeRework = rounds.some((item) => {
    if (
      item.ticket !== round.ticket ||
      item.verdict !== 'needs_work' ||
      (item.track === round.track && item.phase === round.phase)
    )
      return false;
    const latest = rounds
      .filter(
        (candidate) =>
          candidate.track === item.track && candidate.phase === item.phase && candidate.ticket === item.ticket,
      )
      .every((candidate) => candidate.round <= item.round);
    return latest && intents.some((intent) => intent.roundId === item.id);
  });
  if (activeRework) return true;
  return owners.some((owner) => {
    if (
      owner.ticket !== round.ticket ||
      !owner.sourceRoundId ||
      owner.sourceRoundId === round.id ||
      (owner.track === round.track && owner.phase === round.phase)
    )
      return false;
    const latest = rounds
      .filter((item) => item.ticket === owner.ticket && item.track === owner.track && item.phase === owner.phase)
      .sort((a, b) => b.round - a.round)[0];
    return latest?.verdict !== 'approved';
  });
}

export function phaseOwner(db: Db, gameId: string, track: ReviewTrack, phase: string): string | null {
  const stored = db
    .select()
    .from(schema.reviewPhaseOwners)
    .where(
      and(
        eq(schema.reviewPhaseOwners.gameId, gameId),
        eq(schema.reviewPhaseOwners.track, track.id),
        eq(schema.reviewPhaseOwners.phase, phase),
      ),
    )
    .get();
  if (stored) return stored.ticket;
  // Only the first phase may be seeded from the committed definition; later owners are assigned by approval.
  const first = track.phases[0];
  if (!first || first.id !== phase || !first.ticket) return null;
  db.insert(schema.reviewPhaseOwners)
    .values({ gameId, track: track.id, phase, ticket: first.ticket })
    .onConflictDoNothing()
    .run();
  return (
    db
      .select()
      .from(schema.reviewPhaseOwners)
      .where(
        and(
          eq(schema.reviewPhaseOwners.gameId, gameId),
          eq(schema.reviewPhaseOwners.track, track.id),
          eq(schema.reviewPhaseOwners.phase, phase),
        ),
      )
      .get()?.ticket ?? null
  );
}

export function assignPhaseOwner(
  db: Db,
  input: { gameId: string; track: string; phase: string; ticket: string; sourceRoundId: string },
): void {
  db.insert(schema.reviewPhaseOwners).values(input).onConflictDoNothing().run();
  const owner = db
    .select()
    .from(schema.reviewPhaseOwners)
    .where(
      and(
        eq(schema.reviewPhaseOwners.gameId, input.gameId),
        eq(schema.reviewPhaseOwners.track, input.track),
        eq(schema.reviewPhaseOwners.phase, input.phase),
      ),
    )
    .get();
  if (!owner || owner.ticket !== input.ticket || owner.sourceRoundId !== input.sourceRoundId)
    throw new Error('review_phase_owner_conflict');
}
