import { and, eq, isNull } from 'drizzle-orm';
import type { AiurClient } from '@ogm/aiur-client';
import { schema, type Db } from '@ogm/db';
import { daemonRowForGame } from '../jobs/daemons.js';
import { phaseOwner } from './owners.js';
import { listTracks } from './tracks.js';

const keyFor = (gameId: string, track: string, phase: string) => `review:missing:${gameId}:${track}:${phase}`;

// The operator endpoint reads these durable alarms. Failures to inspect a ticket leave its previous alarm intact.
export async function inspectReviewOwners(deps: {
  db: Db;
  clientForGame: (gameId: string) => Promise<AiurClient>;
  log: (line: Record<string, unknown>) => void;
  now: () => string;
}): Promise<void> {
  const games = deps.db.select().from(schema.games).all();
  for (const game of games) {
    const daemon = daemonRowForGame(deps.db, game.id);
    if (!daemon || !game.githubPath || (daemon.status !== 'running' && daemon.status !== 'idle')) continue;
    try {
      for (const track of await listTracks(daemon.checkoutPath, game.githubPath)) {
        const first = track.phases[0];
        if (first) phaseOwner(deps.db, game.id, track, first.id);
      }
      const client = await deps.clientForGame(game.id);
      const owners = deps.db
        .select()
        .from(schema.reviewPhaseOwners)
        .where(eq(schema.reviewPhaseOwners.gameId, game.id))
        .all();
      for (const owner of owners) {
        try {
          const issue = await client.issue(owner.ticket);
          const idle = issue.idle;
          const inReview =
            issue.status === 'idle' &&
            !!idle &&
            typeof idle === 'object' &&
            'state' in idle &&
            idle.state === 'human-review';
          const open = deps.db
            .select({ id: schema.reviewRounds.id })
            .from(schema.reviewRounds)
            .where(
              and(
                eq(schema.reviewRounds.gameId, game.id),
                eq(schema.reviewRounds.track, owner.track),
                eq(schema.reviewRounds.phase, owner.phase),
                eq(schema.reviewRounds.ticket, owner.ticket),
                isNull(schema.reviewRounds.verdict),
              ),
            )
            .get();
          const key = keyFor(game.id, owner.track, owner.phase);
          if (inReview && !open) {
            const existing = deps.db.select().from(schema.appMeta).where(eq(schema.appMeta.key, key)).get();
            if (!existing) {
              const value = JSON.stringify({
                gameId: game.id,
                track: owner.track,
                phase: owner.phase,
                ticket: owner.ticket,
                at: deps.now(),
              });
              deps.db.insert(schema.appMeta).values({ key, value }).onConflictDoNothing().run();
              deps.log({
                event: 'review_round_missing_error',
                gameId: game.id,
                ticket: owner.ticket,
                track: owner.track,
                phase: owner.phase,
              });
            }
          } else deps.db.delete(schema.appMeta).where(eq(schema.appMeta.key, key)).run();
        } catch (error) {
          deps.log({
            event: 'review_owner_inspection_error',
            gameId: game.id,
            ticket: owner.ticket,
            error: (error as Error).name,
          });
        }
      }
    } catch (error) {
      deps.log({ event: 'review_track_inspection_error', gameId: game.id, error: (error as Error).name });
    }
  }
}
