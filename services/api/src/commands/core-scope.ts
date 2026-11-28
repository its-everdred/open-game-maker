import { schema } from '@ogm/db';
import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { belongsToGame, ticketScope } from '../worker-progress/scope.js';

// A core daemon may also dispatch game tickets. A missing or stale tracker snapshot is not proof of core ownership.
export async function coreTicketFilter(
  deps: AppDeps,
  repo: { owner: string; name: string } | undefined,
  closed = false,
) {
  if (!repo || !deps.registry.trackerTickets) throw new HttpError(503, 'core_tracker_unavailable');
  const snapshots = await Promise.all([
    deps.registry.trackerTickets(repo, 'open'),
    ...(closed ? [deps.registry.trackerTickets(repo, 'closed')] : []),
  ]).catch(() => {
    throw new HttpError(503, 'core_tracker_unavailable');
  });
  if (snapshots.some((snapshot) => snapshot.stale)) throw new HttpError(503, 'core_tracker_unavailable');
  const repoName = `${repo.owner}/${repo.name}`.toLowerCase();
  const scopes = deps.db
    .select()
    .from(schema.games)
    .all()
    .filter(
      (game) =>
        game.githubOwner && game.githubRepo && `${game.githubOwner}/${game.githubRepo}`.toLowerCase() === repoName,
    )
    .map((game) => ticketScope(deps.db, game.id, game.slug ?? '', repoName));
  const allowed = new Set(
    snapshots
      .flatMap((snapshot) => snapshot.tickets)
      .filter(
        (ticket) =>
          !ticket.labels.some((label) => label.startsWith('game:')) &&
          !scopes.some((scope) => belongsToGame(ticket, scope)),
      )
      .map((ticket) => ticket.ticket),
  );
  return (ticket: string) => allowed.has(ticket);
}
