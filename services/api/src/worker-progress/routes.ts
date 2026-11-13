import { Hono } from 'hono';
import type { ApiBindings } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { authorizedGame } from '../games/authorize.js';
import { listWorkers } from './list.js';
import { recentCompletions } from './completions.js';

export const prefix = '/api/v1';

export default new Hono<ApiBindings>().get('/games/:gameId/workers', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const history = game.slug ? recentCompletions(deps.db, game.slug) : { cursor: 0, completed: [] };
  const client = await deps.aiurClientForGame(game.id).catch((error: unknown) => {
    if (error instanceof HttpError && error.code === 'daemon_not_found') return null;
    throw error;
  });
  if (client === null) return c.json({ workers: [], ...history });
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  const workers = await listWorkers(
    client,
    (ticket) => deps.registry.workerWorkpad?.(ticket, repo) ?? Promise.resolve(''),
  );
  return c.json({ workers, ...history });
});
