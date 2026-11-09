import { AiurHttpError } from '@ogm/aiur-client';
import type { VoiceCommandAnswerRequest, VoiceCommandAnswerResponse } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { and, eq } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { findCheckpoint } from '../build-chat/store.js';
import { answerCheckpoint } from '../checkpoints/answer.js';
import { parseCommandOptions } from '../checkpoints/options.js';
import { jobFor } from './briefing-push.js';
import { answerProductQuestion } from './question-session.js';

export function selectedOption<T extends { id: string; label: string }>(available: T[], choice: string): T | null {
  const exact = available.find(({ id, label }) => id === choice || label === choice);
  if (exact) return exact;
  const folded = choice.toLocaleLowerCase();
  const matches = available.filter(
    ({ id, label }) => id.toLocaleLowerCase() === folded || label.toLocaleLowerCase() === folded,
  );
  return matches.length === 1 ? matches[0]! : null;
}

export async function answerVoiceCommand(
  deps: AppDeps,
  request: VoiceCommandAnswerRequest,
): Promise<VoiceCommandAnswerResponse> {
  const target = request.target;
  if (target.kind === 'questions') return answerProductQuestion(deps, { ...request, target });
  const job = jobFor(deps.db, target);
  if (
    !job ||
    job.gameId !== target.game_id ||
    job.creatorId !== target.creator_id ||
    job.aiurRepo === null ||
    job.aiurIssueNumber === null
  ) {
    return { status: 'failed' };
  }
  if (target.kind === 'build' && (job.id !== target.job_id || String(job.aiurIssueNumber) !== target.ticket)) {
    return { status: 'failed' };
  }
  if (target.kind === 'scope') {
    const session = deps.db
      .select()
      .from(schema.scopeSessions)
      .where(eq(schema.scopeSessions.id, target.session_id))
      .get();
    if (!session || session.gameId !== target.game_id || session.creatorId !== target.creator_id) {
      return { status: 'failed' };
    }
  }

  const command = deps.db
    .select()
    .from(schema.checkpoints)
    .where(and(eq(schema.checkpoints.decisionId, request.command_id), eq(schema.checkpoints.jobId, job.id)))
    .get();
  if (!command || command.status !== 'open') return { status: 'stale' };
  const available = parseCommandOptions(command.options);
  if (available === null) return { status: 'failed' };
  const option = available.length === 0 ? null : selectedOption(available, request.choice);
  if (available.length > 0 && option === null) return { status: 'failed' };

  // A Command the build chat holds is answered through the same path a click takes, so a spoken answer and a clicked
  // one leave one record: the chat row the inbox reads, the job's inbox, the design decision history and aiur.
  const chatJob = option === null ? null : await deps.registry.chatJobs?.get(job.id);
  const row = chatJob ? findCheckpoint(deps.sqlite, job.id, command.decisionId) : null;
  if (chatJob && row && option) {
    let outcome;
    try {
      outcome = await answerCheckpoint({
        deps,
        job: chatJob,
        row,
        optionId: option.id,
        source: 'player',
        channel: 'voice',
      });
    } catch (error) {
      deps.log({ event: 'voice-command-answer-failed', jobId: job.id, error: (error as Error).name });
      return { status: 'failed' };
    }
    if (outcome.kind === 'conflict') return { status: 'stale' };
    if (outcome.kind !== 'answered' && outcome.kind !== 'superseded') return { status: 'failed' };
    closeCommand(deps, command.decisionId);
    return { status: 'answered' };
  }

  try {
    const client = await deps.aiurClientForGame(job.gameId);
    await client.decide(command.decisionId, {
      ...(option === null ? { response: request.choice } : { option: option.id }),
      expected_version: command.version,
      idempotency_key: request.idempotency_key,
      rationale: 'Creator answered the Command in two-way voice',
      confidence: 100,
      alternatives_considered: [],
      reversibility_belief: 'reversible',
    });
  } catch (error) {
    if (error instanceof AiurHttpError && error.status === 409) return { status: 'stale' };
    deps.log({ event: 'voice-command-answer-failed', jobId: job.id, error: (error as Error).name });
    return { status: 'failed' };
  }

  closeCommand(deps, command.decisionId);
  return { status: 'answered' };
}

function closeCommand(deps: AppDeps, decisionId: string): void {
  deps.db
    .update(schema.checkpoints)
    .set({ status: 'answered', answeredAt: new Date().toISOString() })
    .where(and(eq(schema.checkpoints.decisionId, decisionId), eq(schema.checkpoints.status, 'open')))
    .run();
}
