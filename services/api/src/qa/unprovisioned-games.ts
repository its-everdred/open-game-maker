import { schema, type Db } from '@ogm/db';
import { and, eq, inArray, ne } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import { isGameProvisioning } from '../games/games.js';
import { readQaState } from './state.js';

/** A snapshot lets the host identify a row even if creation failed before returning its ID. */
export function listNewQaGames(db: Db) {
  const qa = readQaState(db);
  if (!qa) throw new HttpError(404, 'qa_account_missing');
  return db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(eq(schema.games.familyId, qa.familyId), eq(schema.games.ownerId, qa.userId), ne(schema.games.id, qa.gameId)),
    )
    .all();
}

/** The host needs the exact QA game's folder and filed requests to verify and clean up its run. */
export function newGameQaReport(db: Db, id: string) {
  const qa = readQaState(db);
  const game = db.select().from(schema.games).where(eq(schema.games.id, id)).get();
  if (!qa || !game || game.id === qa.gameId || game.ownerId !== qa.userId || game.familyId !== qa.familyId)
    throw new HttpError(404, 'qa_game_not_found');
  const jobs = db
    .select({
      id: schema.jobs.id,
      kind: schema.jobs.kind,
      state: schema.jobs.state,
      releasedAt: schema.jobs.releasedAt,
      repo: schema.jobs.aiurRepo,
      issue: schema.jobs.aiurIssueNumber,
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.gameId, id))
    .all();
  const daemon =
    game.slug === null
      ? undefined
      : db
          .select({ status: schema.gameDaemons.status, repo: schema.gameDaemons.repo })
          .from(schema.gameDaemons)
          .where(eq(schema.gameDaemons.slug, game.slug))
          .get();
  const tickets = qaJobTickets(
    db,
    jobs.map((job) => job.id),
  );
  return {
    game: {
      id: game.id,
      slug: game.slug,
      path: game.githubPath,
      repoUrl: game.repoUrl,
      repository: game.githubOwner && game.githubRepo ? `${game.githubOwner}/${game.githubRepo}` : null,
    },
    jobs,
    tickets,
    sessions: qaScopeSessions(db, id),
    daemon: daemon ?? null,
  };
}

// The host verifies GitHub cleanup before this call; a null repo URL alone does not prove the remote folder is absent.
type QaTicket = { jobId: string; key: string; repo: string; issue: number };
type QaSession = { id: string; jobId: string };

function qaScopeSessions(db: Db, gameId: string): QaSession[] {
  return db
    .select({ id: schema.scopeSessions.id, jobId: schema.scopeSessions.jobId })
    .from(schema.scopeSessions)
    .where(eq(schema.scopeSessions.gameId, gameId))
    .all();
}

function qaJobTickets(db: Db, ids: string[]): QaTicket[] {
  if (ids.length === 0) return [];
  return db
    .select({
      jobId: schema.jobTickets.jobId,
      key: schema.jobTickets.key,
      repo: schema.jobTickets.repo,
      issue: schema.jobTickets.issueNumber,
    })
    .from(schema.jobTickets)
    .where(inArray(schema.jobTickets.jobId, ids))
    .all();
}

function ticketKeys(tickets: QaTicket[]): string[] {
  return tickets.map(({ jobId, key, repo, issue }) => JSON.stringify([jobId, key, repo, issue])).sort();
}

export function deleteQaNewGame(
  db: Db,
  id: string,
  expected: { folder: string; repo: string; jobs: string[]; tickets: QaTicket[]; sessions: QaSession[] },
  instanceRepo: string,
): void {
  db.transaction((tx) => {
    if (isGameProvisioning(id)) throw new HttpError(409, 'qa_game_provisioning_active');
    const qa = readQaState(tx);
    const game = tx.select().from(schema.games).where(eq(schema.games.id, id)).get();
    if (!qa || !game) throw new HttpError(404, 'qa_game_not_found');
    const repo = game.githubOwner && game.githubRepo ? `${game.githubOwner}/${game.githubRepo}` : instanceRepo;
    if (
      id === qa.gameId ||
      game.ownerId !== qa.userId ||
      game.familyId !== qa.familyId ||
      game.githubPath !== expected.folder
    )
      throw new HttpError(409, 'qa_game_cleanup_mismatch');
    if (game.slug === null) throw new HttpError(409, 'qa_game_slug_missing');
    if (repo.toLowerCase() !== expected.repo.toLowerCase()) throw new HttpError(409, 'qa_game_cleanup_mismatch');
    if (game.repoUrl !== null && game.repoUrl.toLowerCase() !== `https://github.com/${repo}`.toLowerCase())
      throw new HttpError(409, 'qa_game_provisioning_unverified');
    if (game.githubPath !== `games/${game.slug}`) throw new HttpError(409, 'qa_game_slug_mismatch');
    const jobs = tx.select().from(schema.jobs).where(eq(schema.jobs.gameId, id)).all();
    if (game.repoUrl === null && jobs.length > 0) throw new HttpError(409, 'qa_game_provisioning_unverified');
    const ids = jobs.map((job) => job.id).sort();
    if (
      JSON.stringify(ids) !== JSON.stringify([...expected.jobs].sort()) ||
      JSON.stringify(ticketKeys(qaJobTickets(tx, ids))) !== JSON.stringify(ticketKeys(expected.tickets)) ||
      JSON.stringify(
        qaScopeSessions(tx, id)
          .map((s) => JSON.stringify([s.id, s.jobId]))
          .sort(),
      ) !== JSON.stringify(expected.sessions.map((s) => JSON.stringify([s.id, s.jobId])).sort()) ||
      jobs.some(
        (job) =>
          !['scope', 'new_game'].includes(job.kind) ||
          !['cancelled', 'done', 'failed'].includes(job.state) ||
          job.releasedAt === null,
      )
    )
      throw new HttpError(409, 'qa_game_has_active_or_unexpected_jobs');
    const daemon = tx.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug)).get();
    if (game.repoUrl === null && daemon) throw new HttpError(409, 'qa_game_provisioning_unverified');
    if (daemon && (daemon.status !== 'stopped' || daemon.repo.toLowerCase() !== repo.toLowerCase()))
      throw new HttpError(409, 'qa_game_daemon_active');
    if (daemon) tx.delete(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug)).run();
    tx.delete(schema.games).where(eq(schema.games.id, id)).run();
  });
}
