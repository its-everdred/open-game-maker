import { Hono, type Context } from 'hono';

import { CommandAnswerBody } from '@ogm/contracts';

import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { authorizedChatJob } from '../build-chat/authorization.js';
import { findCheckpoint, parseCheckpoint } from '../build-chat/store.js';
import { HttpError } from '../app/errors.js';
import { answerCheckpoint, type AnswerOutcome } from './answer.js';
import { checkpointBudget } from './budget.js';
import { createCheckpointPoller } from './poller.js';
import { recordSupervisorTokenStatus } from './health.js';
import { getChatRuntime } from '../build-chat/routes.js';
import { allowAnswer, checkpointRuntime, setupCheckpointRuntime } from './runtime.js';

export const prefix = '/api/v1/jobs';
// A plain answer is `{ option_id }`; a review deck's answer also carries the whole like/dislike map (A3).
const AnswerBody = CommandAnswerBody;

export function setup(deps: AppDeps): void {
  const runtime = setupCheckpointRuntime(deps);
  if (deps.config.checkpointPollMs === undefined) return;
  createCheckpointPoller({
    db: deps.db,
    sqlite: deps.sqlite,
    jobs: () => deps.registry.chatJobs,
    clientFor: () => deps.registry.aiurClientFor,
    inbox: runtime.inbox,
    publish: (jobId) => getChatRuntime(deps).hub.publish(jobId),
    log: deps.log,
    supervisorTokenStatus: (daemon, missing) => recordSupervisorTokenStatus(deps, daemon, missing),
  }).start(deps.config.checkpointPollMs);
}

// A single answer outcome in the shape the Command surfaces already read: a plain answer, a design decision's later
// answer, or the winner's state when another writer answered first.
export function answerResponse(c: Context<ApiBindings>, outcome: AnswerOutcome) {
  switch (outcome.kind) {
    case 'not_linked':
      return c.json({ status: 'not_linked' as const }, 425);
    case 'invalid_option':
      throw new HttpError(400, 'checkpoint_option_invalid');
    case 'review_invalid':
      throw new HttpError(400, 'checkpoint_review_invalid', outcome.reason);
    case 'client_unavailable':
      throw new HttpError(503, 'daemon_credentials_unavailable');
    case 'answered':
      return c.json({ status: 'answered' as const, decision_id: outcome.decisionId, option_id: outcome.optionId }, 200);
    case 'superseded':
      return c.json(
        {
          status: 'superseded' as const,
          decision_id: outcome.decisionId,
          option_id: outcome.optionId,
          supersedes: outcome.supersedes,
        },
        200,
      );
    case 'conflict':
      return c.json({ status: outcome.status, by: 'other' as const }, 409);
  }
}

export default new Hono<ApiBindings>()
  .get('/:jobId/checkpoints/budget', async (c) => {
    const job = await authorizedChatJob(c, 'game.edit', true);
    return c.json(checkpointBudget(c.get('deps').sqlite, job.jobId, job.kind));
  })
  .post('/:jobId/checkpoints/:checkpointId/answer', async (c) => {
    const job = await authorizedChatJob(c, 'job.create', true);
    const deps = c.get('deps');
    if (!allowAnswer(checkpointRuntime(deps), job.jobId)) throw new HttpError(429, 'rate_limited');
    const { option_id, review } = await parseBody(c, AnswerBody);
    const row = findCheckpoint(deps.sqlite, job.jobId, c.req.param('checkpointId'));
    if (!row) throw new HttpError(404, 'checkpoint_not_found');
    return answerResponse(
      c,
      await answerCheckpoint({ deps, job, row, optionId: option_id, source: 'player', ...(review ? { review } : {}) }),
    );
  })
  // Skipping a question takes the recommendation, which is an answer like any other: dependent tickets unblock and the
  // decision history records that the player delegated rather than chose.
  .post('/:jobId/checkpoints/:checkpointId/skip', async (c) => {
    const job = await authorizedChatJob(c, 'job.create', true);
    const deps = c.get('deps');
    if (!allowAnswer(checkpointRuntime(deps), job.jobId)) throw new HttpError(429, 'rate_limited');
    const row = findCheckpoint(deps.sqlite, job.jobId, c.req.param('checkpointId'));
    if (!row) throw new HttpError(404, 'checkpoint_not_found');
    const checkpoint = parseCheckpoint(row);
    if (checkpoint === null) return c.json({ status: 'not_linked' as const }, 425);
    if (checkpoint.recommend === undefined) throw new HttpError(409, 'checkpoint_recommendation_missing');
    return answerResponse(
      c,
      await answerCheckpoint({ deps, job, row, optionId: checkpoint.recommend, source: 'skip' }),
    );
  });
