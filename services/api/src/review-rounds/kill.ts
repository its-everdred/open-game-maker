import { eq } from 'drizzle-orm';
import type { ReviewTrack } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { phaseOwner } from './owners.js';
import type { ReviewRound } from './store.js';
import type { ReviewIssues } from './issues.js';

export async function stopReview(
  db: Db,
  round: ReviewRound,
  track: ReviewTrack,
  repo: string,
  issues: Pick<ReviewIssues, 'cancel'>,
  now: string,
): Promise<void> {
  if (
    round.verdict !== 'kill' ||
    track.id !== round.track ||
    track.category !== round.category ||
    phaseOwner(db, round.gameId, track, round.phase) !== round.ticket
  )
    throw new Error('review_phase_owner_mismatch');
  const others = db
    .select()
    .from(schema.reviewPhaseOwners)
    .where(eq(schema.reviewPhaseOwners.gameId, round.gameId))
    .all();
  if (
    others.some(
      (owner) => owner.ticket === round.ticket && (owner.track !== round.track || owner.phase !== round.phase),
    )
  )
    throw new Error('review_kill_shared_ticket');
  db.insert(schema.reviewDispatchIntents)
    .values({ roundId: round.id, ticket: round.ticket, state: 'dispatching', createdAt: now })
    .onConflictDoNothing()
    .run();
  const intent = db
    .select()
    .from(schema.reviewDispatchIntents)
    .where(eq(schema.reviewDispatchIntents.roundId, round.id))
    .get();
  if (!intent || intent.ticket !== round.ticket) throw new Error('review_intent_mismatch');
  if (intent.state === 'consumed') return;
  await issues.cancel(repo, round.ticket);
  db.update(schema.reviewDispatchIntents)
    .set({ state: 'consumed' })
    .where(eq(schema.reviewDispatchIntents.roundId, round.id))
    .run();
}
