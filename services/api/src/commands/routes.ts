import { AiurHttpError } from '@ogm/aiur-client';
import { Hono } from 'hono';
import { z } from 'zod';

import { CommandAnswerBody, type CreatorCommandsPage, type GameCommandsPage } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { parseBody } from '../app/validate.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { reviewDecisionFields, reviewProblem } from '../reviews/review-answer.js';
import { tryRecordReview } from '../reviews/store.js';
import { toGameCommand } from './aiur.js';
import { listCreatorCommands, listGameCommands } from './list.js';

export const prefix = '/api/v1';

// The Commands inbox (M3): one game's open aiur Commands across its tickets, in the shape the embeddable
// `<aiur-commands>` component consumes (aiur#7487). A job's Commands answer through the job's checkpoint route; a
// registered game's Commands have no job and answer through this route, which calls aiur's Decision API directly.

const AnswerCommandBody = CommandAnswerBody.extend({
  // The version the player saw. Aiur refuses an answer to a newer version, so a stale inbox shows its conflict.
  version: z.number().int().positive(),
});

export default new Hono<ApiBindings>()
  .get('/games/:gameId/commands', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const page: GameCommandsPage = { commands: await listGameCommands(c.get('deps'), game) };
    return c.json(page);
  })
  // The menu's decision inbox: the caller's player-facing Commands across every game they may edit.
  .get('/me/commands', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const page: CreatorCommandsPage = { commands: await listCreatorCommands(c.get('deps'), principal) };
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
