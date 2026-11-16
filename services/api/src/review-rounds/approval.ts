import { and, eq } from 'drizzle-orm';
import { FidelityPhase, phaseEffort, type ReviewTrack } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import type { ReviewRound } from './store.js';
import { assignPhaseOwner, phaseOwner, otherPhaseInProgress } from './owners.js';
import { reviewAllowsClose, reviewApprovalsSettled } from './close-gate.js';
import { dispatchRework, type ReworkDelivery } from './rework.js';
import type { ReviewIssues } from './issues.js';

export async function advanceApproval(input: {
  db: Db;
  round: ReviewRound;
  track: ReviewTrack;
  repo: string;
  issues: Pick<ReviewIssues, 'setFidelity' | 'close' | 'legacyStarted' | 'integrated'>;
  enqueueLegacy: (ticket: string) => Promise<void>;
  delivery: ReworkDelivery;
  now: () => string;
}): Promise<void> {
  const { db, round, track, repo, issues, delivery, enqueueLegacy, now } = input;
  if (round.verdict !== 'approved') throw new Error('review_round_not_approved');
  if (
    track.id !== round.track ||
    track.category !== round.category ||
    phaseOwner(db, round.gameId, track, round.phase) !== round.ticket
  )
    throw new Error('review_phase_owner_mismatch');
  const index = track.phases.findIndex((phase) => phase.id === round.phase);
  if (index < 0) throw new Error('review_phase_missing');
  const intent = db
    .select()
    .from(schema.reviewDispatchIntents)
    .where(eq(schema.reviewDispatchIntents.roundId, round.id))
    .get();
  if (intent?.state === 'consumed') return;
  const next = track.phases[index + 1];
  if (next) {
    // One ticket has one pair of fidelity labels. Finish any already-started phase before switching them again.
    if (otherPhaseInProgress(db, round)) return;
    const phase = FidelityPhase.safeParse(next.id);
    const rung = phase.success ? phase.data : (FidelityPhase.options[index + 1] ?? 'polish');
    if (!rung) throw new Error('review_phase_rung_unknown');
    const effort = phaseEffort(next, index + 1);
    const previous = db
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
    if (
      previous &&
      previous.ticket !== round.ticket &&
      previous.sourceRoundId === round.id &&
      (intent?.state === 'dispatching' || intent?.state === 'delivered') &&
      (intent.runId === previous.ticket || intent.runId === null)
    ) {
      // An old enqueue may have succeeded before its receipt was recorded; never cancel that successor.
      if (!intent.runId) {
        if (!(await issues.legacyStarted(repo, previous.ticket))) {
          if (!(await issues.integrated(repo, round.sha, round.prNumber))) return;
          await enqueueLegacy(previous.ticket);
        }
        db.update(schema.reviewDispatchIntents)
          .set({ runId: previous.ticket })
          .where(eq(schema.reviewDispatchIntents.roundId, round.id))
          .run();
      }
      const owners = db
        .select()
        .from(schema.reviewPhaseOwners)
        .where(eq(schema.reviewPhaseOwners.gameId, round.gameId))
        .all()
        .map((owner) => ({ ...owner, status: '' }));
      const rounds = db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.gameId, round.gameId)).all();
      db.update(schema.reviewDispatchIntents)
        .set({ state: 'delivered' })
        .where(eq(schema.reviewDispatchIntents.roundId, round.id))
        .run();
      const intents = db
        .select()
        .from(schema.reviewDispatchIntents)
        .where(eq(schema.reviewDispatchIntents.ticket, round.ticket))
        .all();
      if (!reviewApprovalsSettled(round.ticket, rounds, intents, round.id)) return;
      if (reviewAllowsClose(round.ticket, round.gameId, owners, rounds)) await issues.close(repo, round.ticket);
      db.update(schema.reviewDispatchIntents)
        .set({ state: 'consumed' })
        .where(eq(schema.reviewDispatchIntents.roundId, round.id))
        .run();
      return;
    }
    assignPhaseOwner(db, {
      gameId: round.gameId,
      track: round.track,
      phase: next.id,
      ticket: round.ticket,
      sourceRoundId: round.id,
    });
    if (intent?.state !== 'delivered') await issues.setFidelity(repo, round.ticket, rung, effort);
    const reason = [
      `Continue on this ticket with phase ${next.id} (${rung}, ${effort}).`,
      next.template,
      `Approved review round: ${round.id}`,
      `Approved commit: ${round.sha}`,
      `Approved media: ${round.media}`,
    ].join('\n\n');
    await dispatchRework(db, round, delivery, now, reason);
    return;
  }
  const owners = db
    .select()
    .from(schema.reviewPhaseOwners)
    .where(eq(schema.reviewPhaseOwners.gameId, round.gameId))
    .all()
    .map((owner) => ({ ...owner, status: '' }));
  const rounds = db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.gameId, round.gameId)).all();
  db.insert(schema.reviewDispatchIntents)
    .values({ roundId: round.id, ticket: round.ticket, state: 'delivered', createdAt: now() })
    .onConflictDoNothing()
    .run();
  const intents = db
    .select()
    .from(schema.reviewDispatchIntents)
    .where(eq(schema.reviewDispatchIntents.ticket, round.ticket))
    .all();
  if (!reviewApprovalsSettled(round.ticket, rounds, intents, round.id)) return;
  if (reviewAllowsClose(round.ticket, round.gameId, owners, rounds)) await issues.close(repo, round.ticket);
  db.insert(schema.reviewDispatchIntents)
    .values({ roundId: round.id, ticket: round.ticket, state: 'consumed', createdAt: now() })
    .onConflictDoUpdate({ target: schema.reviewDispatchIntents.roundId, set: { state: 'consumed' } })
    .run();
}
