import type { Context } from 'hono';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ChatJob } from '../app/registry.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGameById } from '../games/authorize.js';

export async function authorizedChatJob(c: Context<ApiBindings>): Promise<ChatJob> {
  requirePrincipal(c, ['user']);
  const job = await c.get('deps').registry.chatJobs?.get(c.req.param('jobId') ?? '');
  if (!job) throw new HttpError(404, 'job_not_found');
  authorizedGameById(c, 'game.edit', job.gameId);
  return job;
}
