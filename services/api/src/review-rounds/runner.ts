import { and, eq, isNull } from 'drizzle-orm';
import type { AiurClient } from '@ogm/aiur-client';
import { schema, type Db } from '@ogm/db';
import { aiurReworkDelivery } from './aiur-delivery.js';
import { recordReconcileHeartbeat } from './heartbeat.js';
import { dispatchRework } from './rework.js';

export function createReviewSync(deps: {
  db: Db;
  clientForGame: (gameId: string) => Promise<AiurClient>;
  log: (line: Record<string, unknown>) => void;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  return async () => {
    const rounds = deps.db
      .select()
      .from(schema.reviewRounds)
      .where(and(eq(schema.reviewRounds.verdict, 'needs_work'), isNull(schema.reviewRounds.consumedByRun)))
      .all();
    for (const round of rounds) {
      try {
        const client = await deps.clientForGame(round.gameId);
        const delivery = aiurReworkDelivery(client, round.id, round.verdictAt!);
        await dispatchRework(deps.db, round, delivery, () => new Date(now()).toISOString());
      } catch (error) {
        deps.log({ event: 'review_round_rework_error', roundId: round.id, error: (error as Error).name });
      }
    }
    recordReconcileHeartbeat(deps.db, now());
  };
}
