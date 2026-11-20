import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { AiurClient } from '@ogm/aiur-client';
import { schema, type Db, type Sqlite } from '@ogm/db';
import { FidelityPhase, phaseEffort, type Notification } from '@ogm/contracts';
import { aiurReworkDelivery } from './aiur-delivery.js';
import { recordReconcileHeartbeat } from './heartbeat.js';
import { dispatchRework } from './rework.js';
import { advanceApproval } from './approval.js';
import { listTracks, reviewCheckout } from './tracks.js';
import { phaseOwner, otherPhaseInProgress } from './owners.js';
import { reviewDaemonForGame } from './daemon.js';
import type { ReviewIssues } from './issues.js';
import { inspectReviewOwners } from './monitor.js';
import { syncCommandVerdicts } from './command-verdicts.js';
import { queueReviewReminders } from './reminders.js';
import { stopReview } from './kill.js';
import { dispatchPublishedPrototypeVerdict } from './publish-verdict.js';

export function createReviewSync(deps: {
  db: Db;
  clientForGame: (gameId: string) => Promise<AiurClient>;
  issues: ReviewIssues;
  log: (line: Record<string, unknown>) => void;
  now?: () => number;
  sqlite?: Sqlite;
  publishReminder?: (notification: Notification) => Promise<void>;
}) {
  const now = deps.now ?? Date.now;
  return async () => {
    recordReconcileHeartbeat(deps.db, now());
    await syncCommandVerdicts(deps.db, deps.clientForGame, () => new Date(now()).toISOString(), deps.log);
    if (deps.sqlite) {
      for (const notification of queueReviewReminders(deps.db, deps.sqlite, now())) {
        void deps.publishReminder?.(notification).catch((error: unknown) => {
          deps.log({ event: 'review_reminder_stream_error', error: (error as Error).name });
        });
      }
    }
    const rounds = deps.db
      .select()
      .from(schema.reviewRounds)
      .where(
        or(
          and(eq(schema.reviewRounds.verdict, 'needs_work'), isNull(schema.reviewRounds.consumedByRun)),
          and(
            or(eq(schema.reviewRounds.verdict, 'approved'), eq(schema.reviewRounds.verdict, 'kill')),
            sql`NOT EXISTS (SELECT 1 FROM review_dispatch_intents i WHERE i.round_id = ${schema.reviewRounds.id} AND i.state = 'consumed')`,
          ),
        ),
      )
      .all();
    for (const round of rounds) {
      try {
        const client = await deps.clientForGame(round.gameId);
        if (round.track === 'prototype-publish') {
          await dispatchPublishedPrototypeVerdict(
            deps.db,
            round,
            aiurReworkDelivery(client, round.id, round.verdictAt ?? new Date(now()).toISOString()),
            () => new Date(now()).toISOString(),
          );
          continue;
        }
        if (round.verdict === 'needs_work') {
          if (otherPhaseInProgress(deps.db, round)) continue;
          const shared = deps.db
            .select()
            .from(schema.reviewPhaseOwners)
            .where(eq(schema.reviewPhaseOwners.gameId, round.gameId))
            .all()
            .some((owner) => owner.ticket === round.ticket && owner.track !== round.track && owner.sourceRoundId);
          const intent = deps.db
            .select()
            .from(schema.reviewDispatchIntents)
            .where(eq(schema.reviewDispatchIntents.roundId, round.id))
            .get();
          if (shared && intent?.state !== 'delivered' && intent?.state !== 'consumed') {
            const game = deps.db.select().from(schema.games).where(eq(schema.games.id, round.gameId)).get();
            const daemon = reviewDaemonForGame(deps.db, round.gameId);
            if (!game?.githubPath || !game.githubOwner || !game.githubRepo || !daemon)
              throw new Error('review_game_not_configured');
            const track = (
              await listTracks(
                await reviewCheckout(daemon.checkoutPath, round.ticket, daemon.repo),
                game.githubPath,
                round.sha,
              )
            ).find((item) => item.id === round.track);
            const index = track?.phases.findIndex((phase) => phase.id === round.phase) ?? -1;
            if (!track || index < 0) throw new Error('review_track_not_found');
            const phase = track.phases[index]!;
            const parsed = FidelityPhase.safeParse(phase.id);
            const rung = parsed.success ? parsed.data : (FidelityPhase.options[index] ?? 'polish');
            if (!rung) throw new Error('review_phase_rung_unknown');
            await deps.issues.setFidelity(
              `${game.githubOwner}/${game.githubRepo}`,
              round.ticket,
              rung,
              phaseEffort(phase, index),
            );
          }
          const delivery = aiurReworkDelivery(client, round.id, round.verdictAt!);
          await dispatchRework(deps.db, round, delivery, () => new Date(now()).toISOString());
        } else {
          const game = deps.db.select().from(schema.games).where(eq(schema.games.id, round.gameId)).get();
          const daemon = reviewDaemonForGame(deps.db, round.gameId);
          if (!game?.slug || !game.githubOwner || !game.githubRepo || !game.githubPath || !daemon)
            throw new Error('review_game_not_configured');
          const checkout = await reviewCheckout(daemon.checkoutPath, round.ticket, daemon.repo);
          const tracks = await listTracks(checkout, game.githubPath, round.sha);
          const currentTracks = await listTracks(checkout, game.githubPath);
          for (const candidate of [...tracks, ...currentTracks]) {
            const first = candidate.phases[0];
            if (first) phaseOwner(deps.db, round.gameId, candidate, first.id);
          }
          const track = tracks.find((candidate) => candidate.id === round.track);
          if (!track) throw new Error('review_track_not_found');
          if (round.verdict === 'kill') {
            await stopReview(
              deps.db,
              round,
              track,
              `${game.githubOwner}/${game.githubRepo}`,
              deps.issues,
              new Date(now()).toISOString(),
            );
          } else
            await advanceApproval({
              db: deps.db,
              round,
              track,
              repo: `${game.githubOwner}/${game.githubRepo}`,
              issues: deps.issues,
              enqueueLegacy: (ticket) => client.enqueueTodo([ticket]),
              delivery: aiurReworkDelivery(client, round.id, round.verdictAt!),
              now: () => new Date(now()).toISOString(),
            });
        }
      } catch (error) {
        deps.log({ event: 'review_round_sync_error', roundId: round.id, error: (error as Error).name });
      }
    }
    await inspectReviewOwners({
      db: deps.db,
      clientForGame: deps.clientForGame,
      log: deps.log,
      now: () => new Date(now()).toISOString(),
    });
    recordReconcileHeartbeat(deps.db, now());
  };
}
