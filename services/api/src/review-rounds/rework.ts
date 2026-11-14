import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';
import type { ReviewRound } from './store.js';

export const reworkMarker = (roundId: string) => `<!-- gm-review-verdict:${roundId} -->`;

export type ReworkDelivery = {
  // Null means the lookup succeeded and neither queued input nor latest rework contains the marker.
  // A found marker may precede a run, in which case runId remains null and the next pass looks again.
  findMarker(ticket: string, marker: string): Promise<{ runId: string | null } | null>;
  rework(ticket: string, reason: string): Promise<void>;
};

export async function dispatchRework(
  db: Db,
  round: ReviewRound,
  delivery: ReworkDelivery,
  now: () => string,
): Promise<'pending' | 'consumed'> {
  if (round.verdict !== 'needs_work') throw new Error('not_a_rework_verdict');
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
  if (intent.state === 'consumed') return 'consumed';
  const marker = reworkMarker(round.id);
  let found = await delivery.findMarker(round.ticket, marker);
  if (found === null) {
    // Preserve the creator's exact words following the marker.
    await delivery.rework(round.ticket, `${marker}\n${round.notes ?? ''}\n<!-- gm-review-end -->`);
    found = await delivery.findMarker(round.ticket, marker);
  }
  if (!found?.runId) return 'pending';
  const runId = found.runId;
  db.transaction((tx) => {
    tx.update(schema.reviewRounds)
      .set({ consumedByRun: runId, consumedAt: now() })
      .where(and(eq(schema.reviewRounds.id, round.id), eq(schema.reviewRounds.gameId, round.gameId)))
      .run();
    tx.update(schema.reviewDispatchIntents)
      .set({ state: 'consumed', runId })
      .where(eq(schema.reviewDispatchIntents.roundId, round.id))
      .run();
  });
  return 'consumed';
}
