import type { AppDeps } from '../app/types.js';
import { HttpError } from '../app/errors.js';
import type { GameRow } from '../games/games.js';
import { listJobs } from '../jobs/repo.js';
import { belongsToGame, ticketScope } from '../worker-progress/scope.js';

// A shared daemon can carry decisions from several games. Tracker state is the authority for unowned tickets.
export async function gameTicketFilter(
  deps: AppDeps,
  game: GameRow,
  includeClosed = false,
): Promise<(ticket: string) => boolean> {
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
