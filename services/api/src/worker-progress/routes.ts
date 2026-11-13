import { Hono } from 'hono';
import type { ApiBindings } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { authorizedGame } from '../games/authorize.js';
import { listWorkers } from './list.js';

export const prefix = '/api/v1';

export default new Hono<ApiBindings>().get('/games/:gameId/workers', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const client = await deps.aiurClientForGame(game.id).catch((error: unknown) => {
    if (error instanceof HttpError && error.code === 'daemon_not_found') return null;
    throw error;
  });
  if (client === null) return c.json({ workers: [] });
  const workers = await listWorkers(client, deps.registry.workerWorkpad ?? (async () => ''));
  return c.json({ workers });
});
