import { AiurHttpError, type AiurClient, type Decision } from '@ogm/aiur-client';
import type { GameCommand } from '@ogm/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import { CommandAnswerBody } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { isForCreator } from '../job-commands/correlate.js';
import { reviewDecisionFields, reviewProblem } from '../reviews/review-answer.js';
import { optionMediaFromAiur } from './aiur-media.js';
import { toGameCommand } from './aiur.js';

export const prefix = '/api/v1';
const Answer = CommandAnswerBody.extend({ version: z.number().int().positive() });

function owner(c: import('hono').Context<ApiBindings>): { client: AiurClient; principal: string } {
  const deps = c.get('deps');
  const principal = requirePrincipal(c, ['user']).userId;
  const families = deps.config.instanceOwnerId
    ? []
    : deps.db.select({ ownerId: schema.families.ownerUserId }).from(schema.families).all();
  const ownerId = deps.config.instanceOwnerId ?? (families.length === 1 ? families[0]!.ownerId : undefined);
  if (!ownerId || principal !== ownerId) throw new HttpError(403, 'forbidden');
  if (!deps.registry.coreAiurClient) throw new HttpError(503, 'core_daemon_unavailable');
  return { client: deps.registry.coreAiurClient, principal };
}
async function coreCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AiurHttpError && error.status === 409) throw new HttpError(409, 'core_conflict');
    throw new HttpError(502, 'core_daemon_unavailable');
  }
}
function open(decision: Decision): boolean {
  return (
    isForCreator(decision) &&
    ['open', 'pending', 'deferred'].includes(decision.decision_status) &&
    !decision.answer &&
    !decision.active_answer
  );
}
function validated(decision: Decision): GameCommand {
  const command = open(decision) ? toGameCommand(decision) : null;
  if (!command || !command.ticket) throw new HttpError(404, 'command_not_found');
  return command;
}

export default new Hono<ApiBindings>()
  .get('/me/core-commands', async (c) => {
    const { client } = owner(c);
    const deps = c.get('deps');
    const decisions = await coreCall(() => client.decisions({}, AbortSignal.timeout(5000)));
    const commands = await Promise.all(
      decisions.filter(open).map(async (decision) => {
        const command = toGameCommand(
          decision,
          await optionMediaFromAiur(deps, client, decision, getChatRuntime(deps).sign),
        );
        return command ? { ...command, source: 'core' as const } : null;
      }),
    );
    const visible = commands.filter((command) => command !== null);
    const workers = await reviewWorkers(client).catch(() => null);
    const targets = (workers ?? [])
      .filter(
        (worker) => worker.state === 'human-review' && !visible.some((command) => command.ticket === worker.ticket),
      )
      .map((worker) => ({ source: 'core' as const, ticket: worker.ticket, title: worker.title }));
    return c.json({ commands: visible, targets, targetsUnavailable: workers === null });
  })
  .get('/core/tickets/:ticket/state', async (c) => {
    const { client } = owner(c);
    const ticket = c.req.param('ticket');
    if (!/^[1-9]\d{0,18}$/u.test(ticket)) throw new HttpError(400, 'invalid_ticket');
    const issue = await coreCall(() => client.issue(ticket));
    return c.json({ state: issue.status });
  })
  .post('/core/commands/:id/answer', async (c) => {
    const { client, principal } = owner(c);
    const body = await parseBody(c, Answer);
    const id = c.req.param('id');
    const decision = await coreCall(() => client.decision(id));
    const command = isForCreator(decision) ? toGameCommand(decision) : null;
    if (!command || !command.ticket) throw new HttpError(404, 'command_not_found');
    if (!command.options.some((option) => option.id === body.option_id))
      throw new HttpError(400, 'command_option_invalid');
    if (body.review) {
      const problem = reviewProblem(command.options, body.review);
      if (problem) throw new HttpError(400, 'command_review_invalid', problem);
    }
    const fields = body.review ? reviewDecisionFields(command.options, body.review, body.option_id) : undefined;
    try {
      await client.answerAsCreator(id, {
        ticket: command.ticket!,
        principal,
        expected_version: body.version,
        idempotency_key: `${id}:${body.version}`,
        rationale: fields?.rationale ?? 'Creator answered the core review',
        ...(fields ? { response: fields.response } : { option: body.option_id }),
      });
    } catch (error) {
      if (error instanceof AiurHttpError && error.status === 409) throw new HttpError(409, 'command_answer_conflict');
      throw new HttpError(502, 'core_daemon_unavailable');
    }
    return c.json({ status: 'answered' });
  })
  .post('/core/tickets/:ticket/missing-review', async (c) => {
    const { client } = owner(c);
    const ticket = c.req.param('ticket');
    if (!/^[1-9]\d{0,18}$/u.test(ticket)) throw new HttpError(400, 'invalid_ticket');
    const workers = await reviewWorkers(client);
    if (!workers.some((worker) => worker.ticket === ticket && worker.state === 'human-review'))
      throw new HttpError(404, 'review_ticket_not_found');
    const decisions = await coreCall(() => client.decisions({ ticket }, AbortSignal.timeout(5000)));
    if (
      decisions.some((decision) => decision.ticket.identifier === ticket && open(decision) && toGameCommand(decision))
    )
      throw new HttpError(409, 'review_present');
    const receipt = await coreCall(() =>
      client.message(
        ticket,
        'This ticket needs a creator review, but no review media was posted. Please post a review with media.',
        `core-review-target:${ticket}`,
      ),
    );
    if (receipt.warning) throw new HttpError(502, 'message_unconfirmed');
    return c.json({ status: 'asked' });
  })
  .post('/core/commands/:id/missing-media', async (c) => {
    const { client } = owner(c);
    const decision = await coreCall(() => client.decision(c.req.param('id')));
    const command = validated(decision);
    if (!hasMissingDeclaredMedia(decision, command)) throw new HttpError(409, 'media_present');
    const receipt = await coreCall(() =>
      client.message(
        command.ticket!,
        'This creator review is missing media. Please add media for every option and resend it.',
        `review-media:${command.decision_id}:${command.version}`,
      ),
    );
    if (receipt.warning) throw new HttpError(502, 'message_unconfirmed');
    return c.json({ status: 'asked' });
  });

async function reviewWorkers(client: AiurClient): Promise<{ ticket: string; title: string; state: string }[]> {
  const state = await coreCall(() => client.state(AbortSignal.timeout(5000)));
  const entries = [...state.running, ...(state.idle ?? []), ...(state.retrying ?? [])];
  return entries.flatMap((item) => {
    const ticket = item.issue_identifier;
    const status = typeof item.state === 'string' ? item.state.replace(/^[^:]+:/, '') : '';
    if (typeof ticket !== 'string' || !/^[1-9]\d{0,18}$/u.test(ticket) || status !== 'human-review') return [];
    return [
      {
        ticket,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : `Ticket ${ticket}`,
        state: status,
      },
    ];
  });
}

// Declared media may still be copying: never tell the worker it is missing until a card has no source at all.
export function hasMissingDeclaredMedia(decision: Decision, command: GameCommand): boolean {
  return command.options.some((option) => {
    if (option.playable) return false;
    const raw = decision.options.find((item) => item.id === option.id);
    return !(raw?.media ?? []).some(
      (media) =>
        ['image', 'animated_image', 'video', 'audio'].includes(media.kind ?? '') &&
        Boolean(media.locator?.value || media.locator?.attachment_id),
    );
  });
}
