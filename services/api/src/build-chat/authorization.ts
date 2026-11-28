import type { Context } from 'hono';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { eq } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ChatJob } from '../app/registry.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGameById } from '../games/authorize.js';

export async function authorizedChatJob(c: Context<ApiBindings>): Promise<ChatJob> {
  requirePrincipal(c, ['user']);
  const job = await c.get('deps').registry.chatJobs?.get(c.req.param('jobId') ?? '');
  if (!job) throw new HttpError(404, 'job_not_found');
  authorizeChatJobAccess(c, job);
  return job;
}

export function authorizeChatJobAccess(c: Context<ApiBindings>, job: ChatJob): void {
  const principal = requirePrincipal(c, ['user']);
  const game = c
    .get('deps')
    .db.select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.id, job.gameId))
    .get();
  if (job.kind === 'scope' && !game) {
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.edit', {
        familyId: job.familyId,
        ownerId: job.ownerId,
      }),
    );
    return;
  }
  authorizedGameById(c, 'game.edit', job.gameId);
}
