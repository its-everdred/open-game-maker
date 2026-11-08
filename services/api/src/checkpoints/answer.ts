import { AiurHttpError, type Decision } from '@ogm/aiur-client';
import type { CommandReview, DesignDecision } from '@ogm/contracts';

import type { ChatJob } from '../app/registry.js';
import type { AppDeps } from '../app/types.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { parseCheckpoint, updateCheckpoint, type ChatRow, type StoredCheckpoint } from '../build-chat/store.js';
import { notifyExecutor } from '../design-decisions/notify.js';
import { isDesignJob, latestForCheckpoint, tryRecordDesignDecision } from '../design-decisions/store.js';
import { reviewDecisionFields, reviewProblem } from '../reviews/review-answer.js';
import { jobTitle, tryRecordReview } from '../reviews/store.js';
import { answeredOption, statusOf } from './correlate.js';
import { checkpointRuntime } from './runtime.js';

// How an answer reached the Command: the player chose it, the player skipped the question and took the recommendation,
// or the provisional default answered it after the wait. The source is what the decision history records as `origin`.
export type AnswerSource = 'player' | 'skip' | 'default';

export type AnswerOutcome =
  | { kind: 'not_linked' }
  | { kind: 'invalid_option' }
  | { kind: 'review_invalid'; reason: string }
  | { kind: 'client_unavailable' }
  | { kind: 'answered'; decisionId: string; optionId: string }
  | { kind: 'superseded'; decisionId: string; optionId: string; supersedes: string | null }
  | { kind: 'conflict'; status: 'open' | 'answered' };

export type AnswerInput = {
  deps: AppDeps;
  job: ChatJob;
  row: ChatRow;
  optionId: string;
  source: AnswerSource;
  // A review deck's like/dislike map, when the Command's options carry media. Validated against the checkpoint before
  // anything is answered, so a client cannot name a card the Command does not have.
  review?: CommandReview;
  // Where the player gave the answer. A spoken answer from two-way voice takes this same path, so the chat row, the
  // inbox, the decision history and aiur all hold one record whichever way the creator answered.
  channel?: 'chat' | 'voice';
  now?: () => Date;
};

function winnerPatch(decision: Decision) {
  const status = statusOf(decision);
  const optionId = answeredOption(decision);
  return {
    version: decision.version,
    status,
    ...(optionId === undefined ? {} : { option_id: optionId }),
  };
}

function rationale(
  source: AnswerSource,
  label: string,
  review?: string,
  channel: AnswerInput['channel'] = 'chat',
): string {
  if (source === 'default') return `Provisional default after the answer window passed without a reply: '${label}'`;
  if (source === 'skip') return `Creator skipped the question and took the recommendation '${label}'`;
  const chose = `Creator chose '${label}' ${channel === 'voice' ? 'in two-way voice' : 'in the build chat'}`;
  return review === undefined ? chose : `${chose}. ${review}`;
}

async function writeInbox(deps: AppDeps, job: ChatJob, checkpoint: StoredCheckpoint, row: ChatRow, optionId: string) {
  await checkpointRuntime(deps).inbox.write(job.jobId, {
    checkpoint_id: checkpoint.checkpoint_id ?? row.id,
    decision_id: checkpoint.decision_id,
    option_id: optionId,
    status: 'answered',
    at: new Date().toISOString(),
  });
}

// Records the design decision behind an answered Command and, when the answer changes an earlier decision or stands
// as a provisional default, tells the Executor so it can re-plan. Non-design Commands record nothing. `late` marks the
// answer as a change to a Command aiur had already answered, which is what the Executor has to hear about — even when
// the earlier answer never reached this history, so `previous` may be null there.
async function recordAnswer(
  input: AnswerInput,
  checkpoint: StoredCheckpoint,
  optionId: string,
  previous: DesignDecision | null,
  late: boolean,
): Promise<void> {
  const { deps, job } = input;
  if (!isDesignJob(job.kind)) return;
  const result = tryRecordDesignDecision(
    deps.db,
    {
      gameId: job.gameId,
      jobId: job.jobId,
      ticket: job.aiur?.ticket ?? null,
      checkpointId: checkpoint.checkpoint_id ?? input.row.id,
      decisionId: checkpoint.decision_id,
      question: checkpoint.question,
      options: checkpoint.options.map(({ id, label }) => ({ id, label })),
      recommended: checkpoint.recommend ?? null,
      chosen: optionId,
      origin: input.source === 'default' ? 'default' : 'player',
      skipped: input.source === 'skip',
    },
    deps.log,
  );
  // The Command is already answered. A history write that failed is logged by the recorder and must not undo the answer,
  // and there is no decision id to name to the Executor, so no notification goes out.
  if (result === null || !result.changed) return;
  const { decision } = result;
  if (input.source === 'default') {
    await notifyExecutor(deps, job.aiur?.daemonSlug, job.gameId, {
      kind: 'default',
      decision,
      afterMs: deps.config.designDefaultMs,
    });
    return;
  }
  if (late) await notifyExecutor(deps, job.aiur?.daemonSlug, job.gameId, { kind: 'superseded', decision, previous });
}

// A review's reasons land in the game's review ledger beside the decision, once the answer is taken. A ledger write that
// fails is logged by the recorder and must not undo the answer; #567 reads these rows to build the game's
// design/feedback.json.
function recordReviewOf(input: AnswerInput, checkpoint: StoredCheckpoint, optionId: string): void {
  const { review } = input;
  if (review === undefined) return;
  const { deps, job } = input;
  tryRecordReview(
    deps.db,
    {
      gameId: job.gameId,
      command: {
        job_id: job.jobId,
        ticket: job.aiur?.ticket ?? null,
        title: jobTitle(deps.db, job.gameId, job.jobId),
        checkpoint_id: checkpoint.checkpoint_id ?? input.row.id,
        decision_id: checkpoint.decision_id,
        version: checkpoint.version ?? 1,
        question: checkpoint.question,
        options: checkpoint.options.map(({ id, label }) => ({ id, label })),
        blocking: checkpoint.blocking ?? false,
        opened_at: input.row.at,
      },
      optionId,
      review,
    },
    deps.log,
  );
}

// Answers one aiur Command through aiur's canonical decision path and records the design decision behind it. A Command
// that aiur already answered keeps that answer: for a design decision a later answer is recorded as a new decision
// that supersedes the earlier one and the Executor re-plans, because an answered aiur decision cannot be re-answered.
export async function answerCheckpoint(input: AnswerInput): Promise<AnswerOutcome> {
  const { deps, job, row, optionId } = input;
  const checkpoint = parseCheckpoint(row);
  if (checkpoint === null || checkpoint.decision_id === '' || checkpoint.version === undefined || job.aiur === null) {
    return { kind: 'not_linked' };
  }
  const option = checkpoint.options.find(({ id }) => id === optionId);
  if (!option) return { kind: 'invalid_option' };
  const review = input.review;
  if (review !== undefined) {
    const problem = reviewProblem(checkpoint.options, review);
    if (problem !== null) return { kind: 'review_invalid', reason: problem };
  }
  const fields = review === undefined ? undefined : reviewDecisionFields(checkpoint.options, review, optionId);

  const design = isDesignJob(job.kind);
  const previous = design ? latestForCheckpoint(deps.db, job.gameId, checkpoint.checkpoint_id ?? row.id) : null;
  if (checkpoint.status === 'answered') {
    // The same answer again — a double click or a retry — is the answer already standing, not a conflict.
    if (checkpoint.option_id === optionId) return { kind: 'answered', decisionId: checkpoint.decision_id, optionId };
    if (!design || checkpoint.option_id === undefined) return { kind: 'conflict', status: 'answered' };
    await recordAnswer(input, checkpoint, optionId, previous, true);
    recordReviewOf(input, checkpoint, optionId);
    const latest = latestForCheckpoint(deps.db, job.gameId, checkpoint.checkpoint_id ?? row.id);
    return {
      kind: 'superseded',
      decisionId: checkpoint.decision_id,
      optionId,
      supersedes: latest?.supersedes ?? null,
    };
  }

  const client = await deps.registry.aiurClientFor?.(job.aiur.daemonSlug);
  if (!client) return { kind: 'client_unavailable' };
  const checkpointId = checkpoint.checkpoint_id ?? row.id;

  try {
    const decided = await client.decide(checkpoint.decision_id, {
      option: optionId,
      expected_version: checkpoint.version,
      idempotency_key: `ogm:${input.source}:${checkpointId}:${checkpoint.version}`,
      rationale: rationale(input.source, option.label, fields?.rationale, input.channel),
      // aiur's "alternatives considered" are the likes left over once the answer's card is taken out; the whole map
      // travels in `response`, so nothing is lost when there are none.
      ...(fields === undefined
        ? {}
        : {
            ...(fields.alternatives_considered === undefined
              ? {}
              : { alternatives_considered: fields.alternatives_considered }),
            response: fields.response,
          }),
    });
    const patch = {
      ...winnerPatch(decided),
      status: 'answered' as const,
      option_id: optionId,
      ...(review === undefined ? {} : { review }),
    };
    await writeInbox(deps, job, checkpoint, row, optionId);
    updateCheckpoint(deps.sqlite, row.id, patch);
    getChatRuntime(deps).hub.publish(job.jobId);
    await recordAnswer(input, checkpoint, optionId, previous, false);
    recordReviewOf(input, checkpoint, optionId);
    return { kind: 'answered', decisionId: checkpoint.decision_id, optionId };
  } catch (error) {
    if (!(error instanceof AiurHttpError) || error.status !== 409) throw error;
    const winner = await client.decision(checkpoint.decision_id);
    const patch = winnerPatch(winner);
    if (patch.status === 'open') {
      updateCheckpoint(deps.sqlite, row.id, patch);
      getChatRuntime(deps).hub.publish(job.jobId);
      return { kind: 'conflict', status: 'open' };
    }
    await writeInbox(deps, job, { ...checkpoint, option_id: patch.option_id ?? '' }, row, patch.option_id ?? '');
    updateCheckpoint(deps.sqlite, row.id, patch);
    getChatRuntime(deps).hub.publish(job.jobId);
    // Someone answered first. Their answer stands, unless this is a design decision the player answered after the
    // default already took it: then the player's answer is the later one and the decision history records it.
    const winnerOption = patch.option_id;
    if (design && input.source !== 'default' && winnerOption !== undefined && winnerOption !== optionId) {
      await recordAnswer(
        input,
        { ...checkpoint, status: 'answered', option_id: winnerOption },
        optionId,
        previous,
        true,
      );
      recordReviewOf(input, checkpoint, optionId);
      const latest = latestForCheckpoint(deps.db, job.gameId, checkpointId);
      return {
        kind: 'superseded',
        decisionId: checkpoint.decision_id,
        optionId,
        supersedes: latest?.supersedes ?? null,
      };
    }
    if (design && winnerOption !== undefined) {
      await recordAnswer(
        { ...input, source: 'player' },
        { ...checkpoint, status: 'answered', option_id: winnerOption },
        winnerOption,
        previous,
        false,
      );
    }
    return { kind: 'conflict', status: 'answered' };
  }
}
