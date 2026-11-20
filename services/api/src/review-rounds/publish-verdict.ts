import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';
import { decisionKeyMarker } from '@ogm/contracts';
import type { ReviewRound } from './store.js';
import type { ReworkDelivery } from './rework.js';
import { reworkMarker } from './rework.js';

/** Published prototype rounds fan a creator's notes back to every merged ticket represented by the build. */
export async function dispatchPublishedPrototypeVerdict(
  db: Db,
  round: ReviewRound,
  delivery: ReworkDelivery,
  now: () => string,
): Promise<boolean> {
  if (round.track !== 'prototype-publish' || !round.verdict) return false;
  const tickets = JSON.parse(round.sourceTickets) as string[];
  const marker = reworkMarker(round.id);
  const sendsRework = round.verdict === 'needs_work' || (round.verdict === 'approved' && round.notes?.trim());
  const consumedRuns: string[] = [];
  if (sendsRework) {
    let delivered = false;
    for (const ticket of tickets) {
      const ticketMarker = `${marker}:${ticket}`;
      const receipt = await delivery.findMarker(ticket, ticketMarker);
      if (receipt?.runId) {
        consumedRuns.push(receipt.runId);
      } else if (receipt?.pending === false) {
        // The marker was delivered, but its ticket no longer has queued work or an active worker to consume it.
        // Settle this round instead of retrying the same marker forever.
      } else {
        delivered = true;
      }
      if (!receipt)
        await delivery.rework(
          ticket,
          `${ticketMarker}\n${decisionKeyMarker(round.id)}\n${round.notes ?? ''}\n<!-- gm-review-end -->`,
        );
    }
    if (delivered) {
      db.insert(schema.reviewDispatchIntents)
        .values({ roundId: round.id, ticket: round.ticket, state: 'dispatching', createdAt: now() })
        .onConflictDoUpdate({ target: schema.reviewDispatchIntents.roundId, set: { state: 'delivered' } })
        .run();
      return true;
    }
  }
  const at = now();
  db.transaction((tx) => {
    tx.insert(schema.reviewDispatchIntents)
      .values({
        roundId: round.id,
        ticket: round.ticket,
        state: 'consumed',
        createdAt: at,
        ...(consumedRuns.length ? { runId: consumedRuns.join(',') } : {}),
      })
      .onConflictDoUpdate({ target: schema.reviewDispatchIntents.roundId, set: { state: 'consumed' } })
      .run();
    tx.update(schema.reviewRounds)
      .set({
        consumedByRun: `publish-review:${round.id}${consumedRuns.length ? `:${consumedRuns.join(',')}` : ''}`,
        consumedAt: at,
      })
      .where(and(eq(schema.reviewRounds.id, round.id), eq(schema.reviewRounds.gameId, round.gameId)))
      .run();
  });
  return true;
}
