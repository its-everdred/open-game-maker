import { Hono } from 'hono';
import type { ApiBindings } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { authorizedGame } from '../games/authorize.js';
import { listWorkers } from './list.js';
import { recentCompletions } from './completions.js';

export const prefix = '/api/v1';

const routes = new Hono<ApiBindings>().get('/games/:gameId/workers', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const history = game.slug ? recentCompletions(deps.db, game.slug) : { cursor: 0, completed: [] };
  const client = await deps.aiurClientForGame(game.id).catch((error: unknown) => {
    if (error instanceof HttpError && error.code === 'daemon_not_found') return null;
    throw error;
  });
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  const waiting =
    repo && game.slug && deps.registry.waitingTickets ? await deps.registry.waitingTickets(game.slug, repo) : [];
  const workers = client === null ? [] : await listWorkers(client);
  const byTicket = new Map(workers.map((worker) => [worker.ticket, worker]));
  for (const item of waiting) {
    const prior = byTicket.get(item.ticket);
    byTicket.set(item.ticket, { ...prior, ...item, percent: null, etaSeconds: null, source: 'unknown' });
  }
  return c.json({ workers: [...byTicket.values()], ...history });
});

routes.get('/games/:gameId/tickets/completed', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  if (!repo || !game.slug || !deps.registry.workerHistory) throw new HttpError(503, 'ticket_history_unavailable');
  return c.json({ tickets: await deps.registry.workerHistory(game.slug, repo) });
});

export default routes;
