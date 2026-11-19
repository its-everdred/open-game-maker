import { and, eq, max } from 'drizzle-orm';
import type { Decision } from '@ogm/aiur-client';
import { CREATOR_AUDIENCE_MARKER } from '@ogm/contracts';
import { schema } from '@ogm/db';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { postRound } from '../review-rounds/store.js';
import { QA_TICKET, readQaState, updateQaState, type QaState } from './state.js';

export type QaMedia = { still: Uint8Array; clip: Uint8Array; audio: Uint8Array };

const roundId = (run: string) => `qa-${run}`;
const decisionId = (run: string) => `qa_${run}`;
const TRACK = 'qa';

function requireQa(deps: AppDeps): QaState {
  const state = readQaState(deps.db);
  if (!state) throw new HttpError(409, 'qa_account_missing');
  return state;
}

// One review round with a picture, a clip and a sound, and one three-option Command (A a picture, B a clip, C a
// sound), both on the QA game's ticket. The round goes straight into the table: a real game's round arrives from its
// daemon with a committed track, which the QA game does not have; everything after it (the deck, the answer route,
// the review runner, the aiur boundary) is the real path.
export async function seedReviewFixtures(deps: AppDeps, run: string, media: QaMedia) {
  const state = requireQa(deps);
  const [still, clip, audio] = await Promise.all([
    deps.blobStore.put(media.still, 'image/png'),
    deps.blobStore.put(media.clip, 'video/mp4'),
    deps.blobStore.put(media.audio, 'audio/mpeg'),
  ]);
  const at = new Date().toISOString();
  const last = deps.db
    .select({ round: max(schema.reviewRounds.round) })
    .from(schema.reviewRounds)
    .where(eq(schema.reviewRounds.gameId, state.gameId))
    .get();
  postRound(deps.db, {
    id: roundId(run),
    gameId: state.gameId,
    track: TRACK,
    phase: 'mock',
    category: 'sound',
    audioVerified: true,
    round: (last?.round ?? 0) + 1,
    ticket: QA_TICKET,
    sha: '0'.repeat(40),
    media: JSON.stringify([
      { kind: 'still', ref: still.hash },
      { kind: 'clip', ref: clip.hash, hasAudio: false },
      { kind: 'audio', ref: audio.hash },
    ]),
    question: 'QA review round',
    postedAt: at,
  });
  const item = (kind: string, mime: string, hash: string) => ({
    kind,
    mime_type: mime,
    width: kind === 'audio' ? null : 640,
    height: kind === 'audio' ? null : 360,
    locator: { kind: 'attachment', attachment_id: hash },
  });
  const decision: Decision = {
    decision_id: decisionId(run),
    version: 1,
    ticket: { identifier: QA_TICKET },
    kind: 'direction_checkpoint',
    authority: 'supervisor_allowed',
    blocking: false,
    reversibility: 'reversible',
    question: 'QA: which one?',
    options: [
      { id: 'a', label: 'Picture', media: [item('image', 'image/png', still.hash)] },
      { id: 'b', label: 'Clip', media: [item('video', 'video/mp4', clip.hash)] },
      { id: 'c', label: 'Sound', media: [item('audio', 'audio/mpeg', audio.hash)] },
    ],
    context: { short_summary: 'QA review', long_context_markdown: CREATOR_AUDIENCE_MARKER },
    answer: null,
    active_answer: null,
    created_at: at,
    decision_status: 'open',
  };
  updateQaState(deps.db, (next) => {
    next.decisions = [...next.decisions.filter((d) => d.decision_id !== decision.decision_id), decision];
  });
  return {
    gameId: state.gameId,
    roundId: roundId(run),
    decisionId: decision.decision_id,
    options: decision.options.length,
  };
}

// What the app did with the run's two verdicts: the round's stored verdict and its dispatch, and what reached the QA
// game's aiur boundary (the round's rework, keyed by the round, and the Command's answer).
export function reviewFixtureReport(deps: AppDeps, run: string) {
  const state = requireQa(deps);
  const round = deps.db
    .select()
    .from(schema.reviewRounds)
    .where(and(eq(schema.reviewRounds.gameId, state.gameId), eq(schema.reviewRounds.id, roundId(run))))
    .get();
  if (!round) throw new HttpError(404, 'qa_run_not_found');
  const intent = deps.db
    .select({ state: schema.reviewDispatchIntents.state })
    .from(schema.reviewDispatchIntents)
    .where(eq(schema.reviewDispatchIntents.roundId, round.id))
    .get();
  return {
    round: { id: round.id, verdict: round.verdict, notes: round.notes, dispatch: intent?.state ?? null },
    received: state.received.filter(
      (item) =>
        (item.kind === 'rework' && item.key === `review-round:${round.id}`) ||
        (item.kind === 'answer' && item.decisionId === decisionId(run)),
    ),
  };
}

// Removes everything a run left (or, with no run, every run's, so a run that died midway cannot leave a card ahead
// of the next run's): its round (the dispatch intent goes with it), its Command and what reached the boundary for
// both, and the QA game's review drafts, ledger rows, answer guards and the QA user's notifications. Blobs are
// content-addressed and the next run stores the same bytes, so they stay.
export function deleteReviewFixtures(deps: AppDeps, run?: string) {
  const state = requireQa(deps);
  const ours = (round: string) => run === undefined || round === roundId(run);
  deps.db.transaction((tx) => {
    tx.delete(schema.reviewRounds)
      .where(
        run === undefined
          ? eq(schema.reviewRounds.gameId, state.gameId)
          : and(eq(schema.reviewRounds.gameId, state.gameId), eq(schema.reviewRounds.id, roundId(run))),
      )
      .run();
    tx.delete(schema.reviewDrafts).where(eq(schema.reviewDrafts.gameId, state.gameId)).run();
    tx.delete(schema.commandReviews).where(eq(schema.commandReviews.gameId, state.gameId)).run();
    tx.delete(schema.reviewAnswerGuards)
      .where(and(eq(schema.reviewAnswerGuards.source, state.gameId), eq(schema.reviewAnswerGuards.ticket, QA_TICKET)))
      .run();
    tx.delete(schema.notifications).where(eq(schema.notifications.userId, state.userId)).run();
  });
  updateQaState(deps.db, (next) => {
    next.decisions = next.decisions.filter((d) => run !== undefined && d.decision_id !== decisionId(run));
    next.received = next.received.filter(
      (item) =>
        !(item.kind === 'rework' && ours(item.key.replace(/^review-round:/u, ''))) &&
        !(item.kind === 'answer' && (run === undefined || item.decisionId === decisionId(run))),
    );
  });
}
