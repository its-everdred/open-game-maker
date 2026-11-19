import type { QaGameReport } from './qa-new-game-api.js';
import { cleanupFailure, cleanupTargetFailure } from './qa-new-game-checks.js';

export type QaCleanupServices = {
  report(id: string): Promise<QaGameReport>;
  cancel(jobId: string): Promise<void>;
  unitStopped(slug: string): Promise<boolean>;
  checkOwnership(folder: string, gameId: string): Promise<void>;
  checkTickets(jobId: string, tickets: { key: string; issue: number }[]): Promise<void>;
  closeParent(jobId: string, gameId: string, issue: number): Promise<void>;
  closeScopeIssue(jobId: string, issue: number): Promise<void>;
  closeCreationPull(folder: string): Promise<void>;
  closeScopePulls(folder: string, issues: { issue: number; sessionId: string }[]): Promise<void>;
  noOpenIssues(slug: string): Promise<void>;
  removeFolder(folder: string): Promise<void>;
  deleteGame(
    id: string,
    folder: string,
    jobs: string[],
    tickets: QaGameReport['tickets'],
    sessions: QaGameReport['sessions'],
  ): Promise<void>;
  readyToDelete(): Promise<void>;
  gameExists(id: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
};

/** Stop the exact QA game's work and remove external artifacts before permitting its database row to be deleted. */
export async function cleanupQaGame(id: string, repo: string, services: QaCleanupServices, waitMs = 40 * 60_000) {
  if (!/^g_[A-Za-z0-9_-]+$/u.test(id)) throw new Error('invalid QA game ID');
  let report = await services.report(id);
  function checkTarget(value: QaGameReport) {
    if (value.game.id !== id) throw new Error('QA report names a different game');
    const failure = cleanupTargetFailure(value, repo);
    if (failure) throw new Error(failure);
  }
  checkTarget(report);
  await services.checkOwnership(report.game.path!, id);
  for (const job of report.jobs) {
    if (!['cancelled', 'done', 'failed'].includes(job.state)) await services.cancel(job.id);
  }
  // Fleet stops an idle daemon after 30 minutes; verify both its registry state and the host unit before deletion.
  const until = Date.now() + waitMs;
  for (;;) {
    report = await services.report(id);
    checkTarget(report);
    const failure = cleanupFailure(report, repo);
    if (!failure && (await services.unitStopped(report.game.slug!))) break;
    if (Date.now() >= until) throw new Error(failure ?? 'QA daemon unit did not stop');
    await services.sleep(5_000);
  }

  for (const job of report.jobs)
    await services.checkTickets(
      job.id,
      report.tickets.filter((ticket) => ticket.jobId === job.id),
    );

  for (const ticket of report.tickets) {
    if (ticket.key === 'new-game') await services.closeParent(ticket.jobId, id, ticket.issue);
    else await services.closeScopeIssue(ticket.jobId, ticket.issue);
  }
  const folder = report.game.path!;
  const slug = report.game.slug!;
  await services.noOpenIssues(slug);
  await services.closeCreationPull(folder);
  await services.closeScopePulls(
    folder,
    report.tickets
      .filter((ticket) => ticket.key === 'scope')
      .map((ticket) => ({
        issue: ticket.issue,
        sessionId: report.sessions.find((session) => session.jobId === ticket.jobId)!.id,
      })),
  );
  await services.removeFolder(folder);
  await services.noOpenIssues(slug);
  for (const job of report.jobs)
    await services.checkTickets(
      job.id,
      report.tickets.filter((ticket) => ticket.jobId === job.id),
    );
  await services.readyToDelete();
  await services.deleteGame(
    id,
    folder,
    report.jobs.map((job) => job.id),
    report.tickets,
    report.sessions,
  );
  if (await services.gameExists(id)) throw new Error('QA game deletion was not verified');
}
