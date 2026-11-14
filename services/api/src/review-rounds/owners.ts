import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';
import type { ReviewTrack } from '@ogm/contracts';

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
