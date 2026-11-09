import { AiurHttpError } from '@ogm/aiur-client';
import type { GameCommand, VoiceCommandAnswerRequest, VoiceCommandAnswerResponse, VoiceTarget } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { findCommand } from '../build-chat/store.js';
import { answerCommand } from '../job-commands/answer.js';
import { listProductQuestions } from '../commands/list.js';
import { listDesignDecisions } from '../design-decisions/store.js';
import { selectedOption } from './select-option.js';

type QuestionsTarget = Extract<VoiceTarget, { kind: 'questions' }>;

// A quick question session (#612): the game's queued product questions, oldest first, and its decision record, so the
// agent asks them one at a time without reopening anything already settled.
export type QuestionSession = {
  commands: { id: string; version: number; question: string; options: { id: string; label: string }[] }[];
  focus: { title: string; text: string };
  record: { title: string; text: string };
};

export async function questionSession(deps: AppDeps, gameId: string): Promise<QuestionSession> {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
  const questions = game === undefined ? [] : await listProductQuestions(deps, game);
  const lines = questions.map((question) => {
    const recommended = question.options.find(({ id }) => id === question.recommend);
    return `- ${question.summary ?? question.title}: ${question.question}${
      recommended === undefined ? '' : ` (the builder recommends ${recommended.label})`
    }`;
  });
  const decisions = listDesignDecisions(deps.db, gameId);
  const settled = decisions.map((decision) => {
    const chosen = decision.options.find(({ id }) => id === decision.chosen)?.label ?? decision.chosen;
    return `- ${decision.id} ${decision.question}: ${chosen}${decision.origin === 'default' ? ' (default)' : ''}`;
  });
  return {
    commands: questions.map((question) => ({
      id: question.decision_id,
      version: question.version,
      question: question.question,
      options: question.options.map(({ id, label }) => ({ id, label })),
    })),
    focus: {
      title: 'Quick questions',
      text: [
        `The creator opened a quick voice chat to answer ${questions.length} queued product questions, in this order:`,
        ...lines,
      ].join('\n'),
    },
    record: {
      title: 'Decision record',
      text: settled.length === 0 ? 'No decisions recorded yet.' : settled.join('\n'),
    },
  };
}

// A spoken answer to one queued product question. A job's question answers through the job's command, so the chat,
// the decision history and aiur hold one record; a registered game's question answers through aiur as the creator.
export async function answerProductQuestion(
  deps: AppDeps,
  request: VoiceCommandAnswerRequest & { target: QuestionsTarget },
): Promise<VoiceCommandAnswerResponse> {
  const { target } = request;
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, target.game_id)).get();
  if (game === undefined) return { status: 'failed' };
  const question: GameCommand | undefined = (await listProductQuestions(deps, game)).find(
    ({ decision_id }) => decision_id === request.command_id,
  );
  if (question === undefined || question.ticket === null) return { status: 'stale' };
  const option = selectedOption(question.options, request.choice);
  if (option === null) return { status: 'failed' };

  const chatJob = question.job_id === null ? null : await deps.registry.chatJobs?.get(question.job_id);
  const row = chatJob ? findCommand(deps.sqlite, chatJob.jobId, question.decision_id) : null;
  try {
    if (chatJob && row) {
      const outcome = await answerCommand({
        deps,
        job: chatJob,
        row,
        optionId: option.id,
        source: 'player',
        channel: 'voice',
      });
      if (outcome.kind === 'conflict') return { status: 'stale' };
      return outcome.kind === 'answered' || outcome.kind === 'superseded'
        ? { status: 'answered' }
        : { status: 'failed' };
    }
    const client = await deps.aiurClientForGame(game.id);
    await client.answerAsCreator(question.decision_id, {
      ticket: question.ticket,
      principal: target.creator_id,
      expected_version: question.version,
      idempotency_key: request.idempotency_key,
      rationale: 'Creator answered the product question in a voice question session',
      option: option.id,
    });
    return { status: 'answered' };
  } catch (error) {
    if (error instanceof AiurHttpError && error.status === 409) return { status: 'stale' };
    deps.log({ event: 'voice-question-answer-failed', gameId: game.id, error: (error as Error).name });
    return { status: 'failed' };
  }
}
