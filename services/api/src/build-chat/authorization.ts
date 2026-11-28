import type { Context } from 'hono';
import { Hono } from 'hono';

import { authorize, type Action } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { principalMiddleware, requirePrincipal } from '../app/principal.js';
import type { ChatJob } from '../app/registry.js';
import type { ApiBindings } from '../app/types.js';
import { isReviewAdmin } from '../games/review-admin.js';

// A long-lived stream must re-resolve its session and current role before delivering later messages.
export async function canReadChat(
  deps: ApiBindings['Variables']['deps'],
  jobId: string,
  headers: Headers,
): Promise<boolean> {
  const app = new Hono<ApiBindings>();
  app.use(async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use(principalMiddleware());
  app.get('/:jobId', async (c) => {
    await authorizedChatJob(c, 'game.edit');
    return c.body(null, 204);
  });
  try {
    return (await app.request(`http://127.0.0.1/${encodeURIComponent(jobId)}`, { headers })).ok;
  } catch {
    return false;
  }
}

export async function authorizedChatJob(c: Context<ApiBindings>, action: Action, ownerOnly = false): Promise<ChatJob> {
  const principal = requirePrincipal(c, ['user']);
  const job = await c.get('deps').registry.chatJobs?.get(c.req.param('jobId') ?? '');
  if (!job) throw new HttpError(404, 'job_not_found');
  if (action === 'game.edit' && !ownerOnly && isReviewAdmin(c.get('deps'), principal)) return job;
  if (principal.capability !== 'creator') throw new HttpError(403, 'forbidden');
  requireAuthorization(
    authorize(actorFromPrincipal(principal), action, {
      gameId: job.gameId,
      familyId: job.familyId,
      ownerId: job.ownerId,
    }),
  );
  if (ownerOnly && principal.userId !== job.ownerId) throw new HttpError(403, 'job_owner_required');
  return job;
}
