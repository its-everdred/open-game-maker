import { AiurHttpError } from '@ogm/aiur-client';
import { Hono } from 'hono';
import { z } from 'zod';

import { CommandAnswerBody, decisionKeyFromMarker, type GameCommandsPage } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import { parseBody } from '../app/validate.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { reviewDecisionFields, reviewProblem } from '../reviews/review-answer.js';
import { tryRecordReview } from '../reviews/store.js';
import { toGameCommand } from './aiur.js';
import coreRoutes, { hasMissingDeclaredMedia } from './core.js';
import { findCommand, parseCommand } from '../build-chat/store.js';
import { isForCreator } from '../job-commands/correlate.js';
import { listCreatorCommands, listGameCommands, shownOneByOne } from './list.js';
import { gameTicketFilter } from './scope.js';
import {
  beginReviewAnswer,
  bindReviewEpisode,
  discardReviewAnswer,
  readReviewEpisode,
} from '../review-rounds/answer-guard.js';
import { getRound } from '../review-rounds/store.js';

export const prefix = '/api/v1';

// The Commands inbox (M3): one game's open aiur Commands across its tickets, in the shape the embeddable
// `<aiur-commands>` component consumes (aiur#7487). A job's Commands answer through the job's Command route; a
// registered game's Commands have no job and answer through this route, which calls aiur's Decision API directly.

const AnswerCommandBody = CommandAnswerBody.extend({
  // The version the player saw. Aiur refuses an answer to a newer version, so a stale inbox shows its conflict.
  version: z.number().int().positive(),
  change_request: z.boolean().optional(),
});

export default new Hono<ApiBindings>()
  .route('/', coreRoutes)
  .get('/games/:gameId/commands', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    // A product question waits for a voice session (#612); the game's inbox shows the decisions only.
    const page: GameCommandsPage = {
      commands: shownOneByOne(c.get('deps'), await listGameCommands(c.get('deps'), game)),
    };
    return c.json(page);
  })
  // The menu's decision inbox: the caller's player-facing Commands across every game they may edit.
  .get('/me/commands', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const page = await listCreatorCommands(c.get('deps'), principal, c.req.query('includeQuestions') === '1');
    return c.json(page);
  })
  .post('/games/:gameId/commands/:decisionId/missing-media', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    if (requirePrincipal(c, ['user']).userId !== game.ownerId) throw new HttpError(403, 'forbidden');
    const deps = c.get('deps');
    const command = (await listGameCommands(deps, game)).find((item) => item.decision_id === c.req.param('decisionId'));
    if (!command || !command.ticket) throw new HttpError(404, 'command_not_found');
    if (command.options.every((option) => option.media || option.audio || option.playable))
      throw new HttpError(409, 'media_present');
    const client = await deps.aiurClientForGame(game.id);
    const decision = await client.decision(command.decision_id);
    // A declared attachment may still be copying to the blob store. Do not report it as absent.
    const stored = command.job_id ? findCommand(deps.sqlite, command.job_id, command.command_id) : null;
    const original = stored ? parseCommand(stored) : null;
    const missing = command.options.filter((option) => !option.media && !option.audio && !option.playable);
    const undeclared = missing.filter(
      (option) => !original?.options.some((item) => item.id === option.id && (item.media_id || item.playable)),
    );
    if (!undeclared.length || !hasMissingDeclaredMedia(decision, { ...command, options: undeclared }))
      throw new HttpError(409, 'media_unavailable');
    const receipt = await client.message(
      command.ticket,
      'This creator review is missing media. Please add media for every option and resend it.',
      `review-media:${command.decision_id}:${command.version}`,
      AbortSignal.timeout(15000),
    );
    if (receipt.warning) throw new HttpError(502, 'message_unconfirmed');
    return c.json({ status: 'asked' });
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
    // The Command aiur holds is read first: a review answer is checked against its cards, so a client cannot name a
    // card the Command does not have, and its ticket scopes the creator's answer grant. A registered game's Command has
    // no job, so its review is recorded with no job id.
    const review = body.review;
    const decision = await client.decision(decisionId);
    const canonical = isForCreator(decision) ? toGameCommand(decision) : null;
    if (canonical === null || canonical.ticket === null) throw new HttpError(404, 'command_not_found');
    if (!(await gameTicketFilter(deps, game, true))(canonical.ticket)) throw new HttpError(404, 'command_not_found');
    if (!canonical.options.some((option) => option.id === body.option_id))
      throw new HttpError(400, 'command_option_invalid');
    // Retain the owning job in the ledger; aiur's decision remains authoritative for the options.
    const owned = review
      ? (await listGameCommands(deps, game)).find(
          (item) => item.decision_id === decisionId && item.ticket === canonical.ticket,
        )
      : undefined;
    const command = owned?.job_id
      ? { ...canonical, job_id: owned.job_id, command_id: owned.command_id, title: owned.title }
      : canonical;
    if (review !== undefined) {
      const problem = reviewProblem(command.options, review);
      if (problem !== null) throw new HttpError(400, 'command_review_invalid', problem);
    }
    const key = decisionKeyFromMarker(decision.context?.long_context_markdown);
    const round = key ? getRound(deps.db, game.id, key) : null;
    const keyedChange =
      body.change_request &&
      review &&
      review.likes.length === 0 &&
      review.dislikes.length > 0 &&
      review.notes?.trim() &&
      round &&
      round.ticket === canonical.ticket &&
      !round.verdict &&
      canonical.options.some((option) => option.id === 'needs_work');
    const decisionReview = keyedChange ? { likes: ['needs_work'], dislikes: [], notes: review.notes } : review;
    const fields =
      decisionReview === undefined ? undefined : reviewDecisionFields(command.options, decisionReview, body.option_id);
    const singlePick =
      review !== undefined &&
      review.likes.length === 1 &&
      review.likes[0] === body.option_id &&
      review.dislikes.length === 0 &&
      review.notes === undefined;
    const selectedOption = keyedChange ? 'needs_work' : body.option_id;
    const ledgerInput =
      review === undefined
        ? undefined
        : { gameId: game.id, command, optionId: selectedOption, review: decisionReview! };
    const answerOption = fields === undefined || singlePick ? body.option_id : undefined;
    const guard =
      review === undefined
        ? undefined
        : beginReviewAnswer(deps.db, game.id, canonical.ticket, `command:${decisionId}:${body.version}`, {
            input: ledgerInput!,
            principal: requirePrincipal(c, ['user']).userId,
            ...(answerOption ? { option: answerOption } : { response: fields!.response }),
          });
    try {
      // The creator's own answer (#631): aiur refuses the supervisor's `decide` on a decision only a human may take.
      // A review's answer is its like/dislike map; aiur takes one of an option or a response, never both.
      await client.answerAsCreator(decisionId, {
        ticket: canonical.ticket,
        principal: requirePrincipal(c, ['user']).userId,
        expected_version: body.version,
        idempotency_key: `${decisionId}:${body.version}`,
        rationale:
          fields === undefined
            ? 'Creator answered the Command in the game inbox'
            : `Creator answered the Command in the game inbox. ${fields.rationale}`,
        ...(fields === undefined || singlePick ? { option: body.option_id } : { response: fields.response }),
      });
    } catch (error) {
      if (guard && error instanceof AiurHttpError && [400, 403, 404, 422].includes(error.status))
        discardReviewAnswer(deps.db, game.id, canonical.ticket, guard);
      // Another writer answered first: aiur's status is final and the inbox refetches.
      if (error instanceof AiurHttpError && error.status === 409) {
        if (guard) {
          const latest = await client.decision(decisionId).catch(() => null);
          if (
            latest &&
            !latest.answer &&
            !latest.active_answer &&
            ['open', 'deferred', 'pending'].includes(latest.decision_status)
          )
            discardReviewAnswer(deps.db, game.id, canonical.ticket, guard);
        }
        return c.json({ status: 'conflict' as const, by: 'other' as const }, 409);
      }
      deps.log({
        event: 'game_command_answer_failed',
        gameId: game.id,
        decisionId,
        error: (error as Error).name,
        ...(error instanceof AiurHttpError ? { status: error.status } : {}),
      });
      throw new HttpError(502, 'aiur_answer_failed');
    }
    if (ledgerInput && !tryRecordReview(deps.db, ledgerInput, deps.log))
      throw new HttpError(503, 'review_ledger_pending');
    if (review !== undefined) {
      const episode = await readReviewEpisode(
        deps.registry.reviewEpisode,
        game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined,
        canonical.ticket,
        ['agent:human-review', ...(game.slug ? [`${game.slug}:human-review`] : [])],
      );
      if (guard) bindReviewEpisode(deps.db, game.id, canonical.ticket, guard, episode);
    }
    return c.json(
      { status: 'answered' as const, decision_id: decisionId, option_id: keyedChange ? 'needs_work' : body.option_id },
      200,
    );
  });
