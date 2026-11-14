import { and, eq } from 'drizzle-orm';
import type { AiurClient } from '@ogm/aiur-client';
import type { ReviewTrack } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import type { ReviewRound } from './store.js';
import { nextPhaseMarker, nextPhaseTicket } from './next-phase.js';
import { assignPhaseOwner, phaseOwner } from './owners.js';
import { reviewAllowsClose } from './close-gate.js';
import type { ReviewIssues } from './issues.js';

export async function advanceApproval(input: {
  db: Db;
  round: ReviewRound;
  track: ReviewTrack;
  repo: string;
  slug: string;
  issues: Pick<ReviewIssues, 'ensureFollowup' | 'close' | 'merged'>;
  client: Pick<AiurClient, 'enqueueTodo'>;
  now: () => string;
}): Promise<void> {
  const { db, round, track, repo, slug, issues, client, now } = input;
  if (round.verdict !== 'approved') throw new Error('review_round_not_approved');
  if (
    track.id !== round.track ||
    track.category !== round.category ||
    phaseOwner(db, round.gameId, track, round.phase) !== round.ticket
  )
    throw new Error('review_phase_owner_mismatch');
  const index = track.phases.findIndex((phase) => phase.id === round.phase);
  if (index < 0) throw new Error('review_phase_missing');
  db.insert(schema.reviewDispatchIntents)
    .values({ roundId: round.id, ticket: round.ticket, state: 'dispatching', createdAt: now() })
    .onConflictDoNothing()
    .run();
  const intent = db
    .select()
    .from(schema.reviewDispatchIntents)
    .where(eq(schema.reviewDispatchIntents.roundId, round.id))
    .get();
  if (!intent || intent.ticket !== round.ticket) throw new Error('review_intent_mismatch');
  if (intent.state === 'consumed') return;
  const next = track.phases[index + 1];
  let nextTicket: string | null = null;
  if (next) {
    const existing = db
      .select()
      .from(schema.reviewPhaseOwners)
      .where(
        and(
          eq(schema.reviewPhaseOwners.gameId, round.gameId),
          eq(schema.reviewPhaseOwners.track, round.track),
          eq(schema.reviewPhaseOwners.phase, next.id),
        ),
      )
      .get();
    if (existing && existing.sourceRoundId !== round.id) throw new Error('review_phase_owner_conflict');
    if (existing) nextTicket = existing.ticket;
    else {
      const issue = nextPhaseTicket(round);
      nextTicket = await issues.ensureFollowup(repo, slug, nextPhaseMarker(round), {
        title: issue.title,
        body: `${issue.body}\n\nPhase: ${next.id}\n\n${next.template}`,
      });
      assignPhaseOwner(db, {
        gameId: round.gameId,
        track: round.track,
        phase: next.id,
        ticket: nextTicket,
        sourceRoundId: round.id,
      });
    }
    // A follow-up is filed immediately, but starts only after its approved source commit reaches the base.
    if (round.prNumber !== null && !(await issues.merged(repo, round.prNumber, round.sha))) return;
    await client.enqueueTodo([nextTicket]);
  }
  // GitHub merge is independent; every known phase owned by this ticket must be approved before closing.
  const owners = db
    .select()
    .from(schema.reviewPhaseOwners)
    .where(eq(schema.reviewPhaseOwners.gameId, round.gameId))
    .all()
    .map((owner) => ({ ...owner, status: '' }));
  const rounds = db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.gameId, round.gameId)).all();
  if (reviewAllowsClose(round.ticket, round.gameId, owners, rounds)) await issues.close(repo, round.ticket);
  db.update(schema.reviewDispatchIntents)
    .set({ state: 'consumed', runId: nextTicket })
    .where(eq(schema.reviewDispatchIntents.roundId, round.id))
    .run();
}
