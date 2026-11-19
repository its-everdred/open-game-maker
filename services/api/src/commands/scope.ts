import type { AppDeps } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import type { GameRow } from '../games/games.js';
import { listJobs } from '../jobs/repo.js';
import { belongsToGame, ticketScope } from '../worker-progress/scope.js';
import { isQaGame, QA_TICKET } from '../qa/state.js';

// A shared daemon can carry decisions from several games. Tracker state is the authority for unowned tickets.
export async function gameTicketFilter(
  deps: AppDeps,
  game: GameRow,
  includeClosed = false,
): Promise<(ticket: string) => boolean> {
  // The QA game (#859) has no repository: its one ticket is the QA ticket its aiur boundary serves.
  if (isQaGame(deps.db, game.id)) return (ticket) => ticket === QA_TICKET;
  const repoName = game.githubOwner && game.githubRepo ? `${game.githubOwner}/${game.githubRepo}`.toLowerCase() : null;
  const owned = new Set(
    listJobs(deps.db, game.id).flatMap((job) =>
      job.aiurIssueNumber !== null && repoName && job.aiurRepo?.toLowerCase() === repoName
        ? [String(job.aiurIssueNumber)]
        : [],
    ),
  );
  if (!game.slug || !game.githubOwner || !game.githubRepo || !deps.registry.trackerTickets) {
    throw new HttpError(503, 'ticket_scope_unavailable');
  }
  const repo = { owner: game.githubOwner, name: game.githubRepo };
  const snapshots = await Promise.all([
    deps.registry.trackerTickets(repo, 'open'),
    ...(includeClosed ? [deps.registry.trackerTickets(repo, 'closed')] : []),
  ]);
  if (snapshots.some((snapshot) => snapshot.stale)) throw new HttpError(503, 'ticket_scope_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  const allowed = new Set(
    snapshots.flatMap((snapshot) =>
      snapshot.tickets.filter((ticket) => belongsToGame(ticket, scope)).map((ticket) => ticket.ticket),
    ),
  );
  return (ticket) => owned.has(ticket) || allowed.has(ticket);
}

// An unprovisioned daemon is expected only while this game's tracker has no open tickets.
export async function hasOpenGameTickets(deps: AppDeps, game: GameRow): Promise<boolean> {
  if (!game.slug || !game.githubOwner || !game.githubRepo || !deps.registry.trackerTickets)
    throw new HttpError(503, 'ticket_scope_unavailable');
  const repo = { owner: game.githubOwner, name: game.githubRepo };
  const snapshot = await deps.registry.trackerTickets(repo, 'open');
  if (snapshot.stale) throw new HttpError(503, 'ticket_scope_unavailable');
  const scope = ticketScope(deps.db, game.id, game.slug, `${repo.owner}/${repo.name}`);
  return snapshot.tickets.some((ticket) => belongsToGame(ticket, scope));
}
