import { eq } from 'drizzle-orm';
import { schema, type Db } from '@ogm/db';
import type { TrackerTicket } from './tracker.js';

export function ticketScope(db: Db, gameId: string, slug: string, repo: string) {
  const slugs = new Set([
    slug,
    ...db
      .select({ slug: schema.gameSlugs.slug })
      .from(schema.gameSlugs)
      .where(eq(schema.gameSlugs.gameId, gameId))
      .all()
      .map((row) => row.slug),
  ]);
  const jobs = db
    .select({ id: schema.jobs.id, issue: schema.jobs.aiurIssueNumber, repo: schema.jobs.aiurRepo })
    .from(schema.jobs)
    .where(eq(schema.jobs.gameId, gameId))
    .all();
  const entries = db
    .select({ issue: schema.jobTickets.issueNumber, repo: schema.jobTickets.repo, jobId: schema.jobTickets.jobId })
    .from(schema.jobTickets)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobTickets.jobId))
    .where(eq(schema.jobs.gameId, gameId))
    .all();
  const owned = new Map<string, string>();
  for (const job of jobs)
    if (job.issue !== null && job.repo?.toLowerCase() === repo.toLowerCase()) owned.set(String(job.issue), job.id);
  for (const entry of entries)
    if (entry.repo.toLowerCase() === repo.toLowerCase()) owned.set(String(entry.issue), entry.jobId);
  return { slugs, owned };
}

export function belongsToGame(ticket: TrackerTicket, scope: ReturnType<typeof ticketScope>): boolean {
  const games = ticket.labels.filter((label) => label.startsWith('game:'));
  return games.length === 1
    ? scope.slugs.has(games[0]!.slice(5))
    : games.length === 0 && scope.owned.has(ticket.ticket);
}
