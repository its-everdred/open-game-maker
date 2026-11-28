import { schema, type Db } from '@ogm/db';
import { and, eq, inArray } from 'drizzle-orm';

/** The relay already authenticated the workspace grant; bind it to the recorded planner ticket and game. */
export function plannerRequest(db: Db, repo: string, ticket: number, gameId: string) {
  const row = db
    .select({ request: schema.jobs.id })
    .from(schema.jobTickets)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobTickets.jobId))
    .where(
      and(
        eq(schema.jobTickets.repo, repo),
        eq(schema.jobTickets.issueNumber, ticket),
        eq(schema.jobTickets.key, 'new-game-plan'),
        eq(schema.jobs.kind, 'new_game'),
        eq(schema.jobs.gameId, gameId),
        eq(schema.jobs.aiurIssueNumber, ticket),
        inArray(schema.jobs.state, ['filed', 'running']),
      ),
    )
    .get();
  return row?.request ?? null;
}
