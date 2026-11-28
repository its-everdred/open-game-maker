import { schema, type Db } from '@ogm/db';
import { and, eq, sql } from 'drizzle-orm';

import type { TicketJobResolver } from '../app/registry.js';
import { scopeChoicesForRequest } from '../new-game/context.js';

/** Resolve only tickets recorded against the same repository and game. */
export function ticketJobResolver(db: Db): TicketJobResolver {
  return async (repo, identifier) => {
    if (!/^[1-9][0-9]{0,15}$/.test(identifier)) return null;
    const issue = Number(identifier);
    if (!Number.isSafeInteger(issue)) return null;
    const ticket = db
      .select()
      .from(schema.jobTickets)
      .where(and(sql`lower(${schema.jobTickets.repo}) = lower(${repo})`, eq(schema.jobTickets.issueNumber, issue)))
      .get();
    const job = ticket
      ? db.select().from(schema.jobs).where(eq(schema.jobs.id, ticket.jobId)).get()
      : db
          .select()
          .from(schema.jobs)
          .where(and(sql`lower(${schema.jobs.aiurRepo}) = lower(${repo})`, eq(schema.jobs.aiurIssueNumber, issue)))
          .get();
    if (!job) return null;
    const game = db.select().from(schema.games).where(eq(schema.games.id, job.gameId)).get();
    if (
      !game?.githubOwner ||
      !game.githubRepo ||
      `${game.githubOwner}/${game.githubRepo}`.toLowerCase() !== repo.toLowerCase()
    )
      return null;
    const parentId = /^planner:(j_[A-Za-z0-9-]+):/.exec(job.idempotencyKey ?? '')?.[1];
    const parent = parentId
      ? db
          .select()
          .from(schema.jobs)
          .where(and(eq(schema.jobs.id, parentId), eq(schema.jobs.gameId, game.id)))
          .get()
      : undefined;
    const value = scopeChoicesForRequest(db, parent ?? job);
    return {
      jobId: job.id,
      gameId: game.id,
      repo,
      kind: job.kind,
      game: {
        title: game.title,
        family: value?.family ?? '',
        pov: value?.pov ?? '',
        genre: value?.genre ?? '',
        multiplayer: value?.players === 'multi',
      },
    };
  };
}
