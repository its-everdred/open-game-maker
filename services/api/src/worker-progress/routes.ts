import { Hono } from 'hono';
import type { ApiBindings } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import { authorizedGame } from '../games/authorize.js';
import { listWorkers } from './list.js';
import { recentCompletions } from './completions.js';
import { belongsToGame, ticketScope } from './scope.js';

export const prefix = '/api/v1';
const routes = new Hono<ApiBindings>().get('/games/:gameId/workers', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const history = game.slug ? recentCompletions(deps.db, game.slug) : { cursor: 0, completed: [] };
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  if (!repo || !game.slug || !deps.registry.trackerTickets) throw new HttpError(503, 'ticket_scope_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  // Fail closed if the tracker is unavailable: a shared daemon may contain another game's tickets.
  const snapshot = await deps.registry.trackerTickets(repo, 'open');
  const tickets = snapshot.tickets.filter(
    (ticket) => (!snapshot.stale || scope.owned.has(ticket.ticket)) && belongsToGame(ticket, scope),
  );
  const allowed = new Map(tickets.map((ticket) => [ticket.ticket, ticket]));
  const observed = new Set(snapshot.tickets.map((ticket) => ticket.ticket));
  let daemonUnavailable = false;
  const workers = await deps
    .aiurClientForGame(game.id)
    .then((client) => listWorkers(client))
    .catch(() => {
      daemonUnavailable = true;
      return [];
    });
  const byTicket = new Map(
    workers
      .filter(
        (worker) => allowed.has(worker.ticket) || (!observed.has(worker.ticket) && scope.owned.has(worker.ticket)),
      )
      .map((worker) => [worker.ticket, { ...worker, title: allowed.get(worker.ticket)?.title ?? worker.title }]),
  );
  for (const item of tickets) {
    const states = item.labels
      .filter((label) => label.startsWith('agent:') || [...scope.slugs].some((slug) => label.startsWith(`${slug}:`)))
      .map((label) => label.replace(/^[^:]+:/, ''))
      .filter((state) => ['human-review', 'ci-wait', 'merging'].includes(state));
    if (states.length !== 1) continue;
    const prior = byTicket.get(item.ticket);
    if (prior?.startedAt && item.updatedAt && Date.parse(prior.startedAt) > Date.parse(item.updatedAt)) continue;
    byTicket.set(item.ticket, {
      ...prior,
      ticket: item.ticket,
      title: item.title,
      state: states[0],
      percent: null,
      etaSeconds: null,
      source: 'unknown',
    });
  }
  return c.json({ workers: [...byTicket.values()], daemonUnavailable, trackerStale: snapshot.stale, ...history });
});

routes.get('/games/:gameId/tickets/completed', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  if (!repo || !game.slug || !deps.registry.trackerTickets) throw new HttpError(503, 'ticket_history_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  const snapshot = await deps.registry.trackerTickets(repo, 'closed');
  const tickets = snapshot.tickets
    .filter(
      (ticket) =>
        ticket.closedAt && (!snapshot.stale || scope.owned.has(ticket.ticket)) && belongsToGame(ticket, scope),
    )
    .map((ticket) => ({
      ticket: ticket.ticket,
      title: ticket.title,
      closedAt: ticket.closedAt,
      outcome: ticket.outcome,
      url: ticket.url,
      jobId: scope.owned.get(ticket.ticket) ?? null,
    }))
    .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!));
  return c.json({ tickets, stale: snapshot.stale });
});
routes.get('/games/:gameId/tickets/:ticket/conversation', async (c) => {
  const game = authorizedGame(c, 'game.edit');
  const deps = c.get('deps');
  const ticketId = c.req.param('ticket');
  const repo = game.githubOwner && game.githubRepo ? { owner: game.githubOwner, name: game.githubRepo } : undefined;
  if (!repo || !game.slug || !deps.registry.trackerTickets || !deps.registry.ticketConversation)
    throw new HttpError(503, 'ticket_conversation_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  const snapshot = await deps.registry.trackerTickets(repo, 'closed');
  if (snapshot.stale) throw new HttpError(503, 'ticket_scope_unavailable');
  if (!snapshot.tickets.some((ticket) => ticket.ticket === ticketId && belongsToGame(ticket, scope)))
    throw new HttpError(404, 'ticket_not_found');
  return c.json({
    messages: await deps.registry.ticketConversation(repo, ticketId, [...scope.slugs], scope.owned.has(ticketId)),
  });
});
export default routes;
