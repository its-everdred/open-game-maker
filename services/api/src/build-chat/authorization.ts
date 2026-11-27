import type { Context } from 'hono';

import { authorize, type Action } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ChatJob } from '../app/registry.js';
import type { ApiBindings } from '../app/types.js';

export async function authorizedChatJob(
  c: Context<ApiBindings>,
  action: Action,
  ownerOnly = false,
  adminRead = false,
): Promise<ChatJob> {
  const principal = requirePrincipal(c, ['user']);
  const job = await c.get('deps').registry.chatJobs?.get(c.req.param('jobId') ?? '');
  if (!job) throw new HttpError(404, 'job_not_found');
  if (adminRead && principal.platformRole !== 'none') return job;
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
