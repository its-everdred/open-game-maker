import { AiurHttpError } from '@ogm/aiur-client';
import { Hono } from 'hono';
import { z } from 'zod';

import { CommandAnswerBody, GameCommand, type GameCommandsPage } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import { parseBody } from '../app/validate.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { getChatRow, listCheckpoints, parseCheckpoint, toMessage, type MediaSigner } from '../build-chat/store.js';
import { listJobs } from '../jobs/repo.js';
import { reviewDecisionFields, reviewProblem } from '../reviews/review-answer.js';
import { reviewNumbers } from '../reviews/numbers.js';
import { tryRecordReview } from '../reviews/store.js';
import { gameCommandsFromAiur, toGameCommand } from './aiur.js';

export const prefix = '/api/v1';

// The Commands inbox (M3): one game's open aiur Commands across its tickets, in the shape the embeddable
// `<aiur-commands>` component consumes (aiur#7487). A job's Commands answer through the job's checkpoint route; a
// registered game's Commands have no job and answer through this route, which calls aiur's Decision API directly.

const AnswerCommandBody = CommandAnswerBody.extend({
  // The version the player saw. Aiur refuses an answer to a newer version, so a stale inbox shows its conflict.
  version: z.number().int().positive(),
});

async function optionMedia(deps: AppDeps, jobId: string, mediaId: string, sign: MediaSigner) {
  const row = getChatRow(deps.sqlite, mediaId);
  if (row === null || row.jobId !== jobId) return undefined;
  return (await toMessage(row, sign)).media;
}

export default new Hono<ApiBindings>()
  .get('/games/:gameId/commands', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const deps = c.get('deps');
    const { sign } = getChatRuntime(deps);
    const commands: GameCommand[] = [];
    const jobs = listJobs(deps.db, game.id);
    const jobTickets = new Set(
      jobs.flatMap((job) => (job.aiurIssueNumber === null ? [] : [String(job.aiurIssueNumber)])),
    );

    for (const job of jobs) {
      for (const row of listCheckpoints(deps.sqlite, job.id)) {
        const checkpoint = parseCheckpoint(row);
        // A Command is answerable only once aiur's decision is correlated (decision id and version known).
        if (!checkpoint || checkpoint.status !== 'open') continue;
        if (checkpoint.decision_id === '' || checkpoint.version === undefined) continue;
        const options = await Promise.all(
          checkpoint.options.map(async (option) => {
            const media =
              option.media_id === undefined ? undefined : await optionMedia(deps, job.id, option.media_id, sign);
            return { id: option.id, label: option.label, ...(media === undefined ? {} : { media }) };
          }),
        );
        // One malformed checkpoint row is left out of the inbox rather than failing every Command in the game.
        const command = GameCommand.safeParse({
          job_id: job.id,
          ticket: job.aiurIssueNumber === null ? null : String(job.aiurIssueNumber),
          title: job.plan.title,
          checkpoint_id: checkpoint.checkpoint_id ?? row.id,
          decision_id: checkpoint.decision_id,
          version: checkpoint.version,
          question: checkpoint.question,
          options,
          ...(checkpoint.recommend === undefined ? {} : { recommend: checkpoint.recommend }),
          blocking: checkpoint.blocking ?? false,
          // How the Command's answer is taken: a review deck's 'one' asks for a single pick from its likes.
          pick: checkpoint.pick ?? 'one',
          opened_at: row.at,
        });
        if (command.success) commands.push(command.data);
      }
    }

    // A registered game's Commands belong to no job. A decision already listed from a job's checkpoint stays the
    // job's, so one Command never appears twice.
    const listed = new Set(commands.map((command) => command.decision_id));
    for (const command of await gameCommandsFromAiur(deps, game.id, jobTickets, sign)) {
      if (!listed.has(command.decision_id)) commands.push(command);
    }

    // Each Command keeps the short number it got the first time it was listed; new ones are numbered oldest first.
    const oldestFirst = [...commands].sort((left, right) => left.opened_at.localeCompare(right.opened_at));
    const numbers = reviewNumbers(
      deps.db,
      game.id,
      oldestFirst.map((command) => command.decision_id),
    );
    const page: GameCommandsPage = {
      commands: commands
        .sort((left, right) => right.opened_at.localeCompare(left.opened_at))
        .map((command) => ({ ...command, review_number: numbers.get(command.decision_id)! })),
    };
    return c.json(page);
  })
  // A Command with no job: the player answered one the game's own aiur instance holds. Aiur's canonical Decision API
  // validates the option and the version, so an answer from here lands exactly as one from the aiur dashboard would.
  .post('/games/:gameId/commands/:decisionId/answer', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const deps = c.get('deps');
    const body = await parseBody(c, AnswerCommandBody);
    const decisionId = c.req.param('decisionId');
    // A game with no daemon row has no aiur instance to answer to; that is a conflict, not a server error.
    const client = await deps.aiurClientForGame(game.id).catch((error: unknown) => {
      if (error instanceof HttpError) throw new HttpError(409, 'daemon_not_found');
      throw error;
    });
    // A review answer is checked against the Command aiur holds before anything is answered, so a client cannot name a
    // card the Command does not have. A registered game's Command has no job, so its review is recorded with no job id.
    const review = body.review;
    const command = review === undefined ? null : toGameCommand(await client.decision(decisionId));
    if (review !== undefined) {
      if (command === null) throw new HttpError(404, 'command_not_found');
      const problem = reviewProblem(command.options, review);
      if (problem !== null) throw new HttpError(400, 'command_review_invalid', problem);
    }
    const fields =
      review === undefined || command === null
        ? undefined
        : reviewDecisionFields(command.options, review, body.option_id);
    try {
      await client.decide(decisionId, {
        option: body.option_id,
        expected_version: body.version,
        idempotency_key: `${decisionId}:${body.version}`,
        rationale:
          fields === undefined
            ? 'Creator answered the Command in the game inbox'
            : `Creator answered the Command in the game inbox. ${fields.rationale}`,
        confidence: 100,
        ...(fields === undefined
          ? { alternatives_considered: [] }
          : fields.alternatives_considered === undefined
            ? {}
            : { alternatives_considered: fields.alternatives_considered }),
        ...(fields === undefined ? {} : { response: fields.response }),
        reversibility_belief: 'reversible',
      });
    } catch (error) {
      // Another writer answered first: aiur's status is final and the inbox refetches.
      if (error instanceof AiurHttpError && error.status === 409) {
        return c.json({ status: 'conflict' as const, by: 'other' as const }, 409);
      }
      deps.log({ event: 'game_command_answer_failed', gameId: game.id, decisionId, error: (error as Error).name });
      throw new HttpError(502, 'aiur_answer_failed');
    }
    if (review !== undefined && command !== null) {
      tryRecordReview(deps.db, { gameId: game.id, command, optionId: body.option_id, review }, deps.log);
    }
    return c.json({ status: 'answered' as const, decision_id: decisionId, option_id: body.option_id }, 200);
  });
