import { schema } from '@ogm/db';
import { and, count, desc, eq, sql } from 'drizzle-orm';

import type { AppDeps } from '../app/types.js';
import { emailsFor } from './family.js';
import type { AdminBuild } from './shapes.js';

const { aiurPhaseEvents, games, jobProjections, jobs } = schema;

// Builds newest first, private and delisted games included. Columns are listed
// one by one so the plan (the creator's prompt) and anything added to `jobs` later stay out.
export async function familyBuilds(deps: AppDeps, familyId: string | undefined): Promise<AdminBuild[]> {
  const rows = deps.db
    .select({
      job: {
        id: jobs.id,
        kind: jobs.kind,
        state: jobs.state,
        pausedReason: jobs.pausedReason,
        usageMicroUsd: jobs.usageMicroUsd,
        hardCapMicroUsd: jobs.hardCapMicroUsd,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        terminalAt: jobs.terminalAt,
      },
      stage: jobProjections.stage,
      stageText: jobProjections.stageText,
      game: {
        id: games.id,
        title: games.title,
        ownerId: games.ownerId,
        visibility: games.visibility,
        delistedAt: games.delistedAt,
      },
      creatorId: jobs.creatorId,
    })
    .from(jobs)
    .innerJoin(games, eq(jobs.gameId, games.id))
    .leftJoin(jobProjections, eq(jobs.id, jobProjections.jobId))
    .where(and(eq(jobs.familyId, games.familyId), familyId === undefined ? undefined : eq(jobs.familyId, familyId)))
    .orderBy(desc(jobs.createdAt), desc(sql`${jobs}.rowid`))
    .all();
  if (rows.length === 0) return [];

  const retries = new Map(
    deps.db
      .select({ jobId: aiurPhaseEvents.jobId, count: count() })
      .from(aiurPhaseEvents)
      .innerJoin(jobs, eq(aiurPhaseEvents.jobId, jobs.id))
      .where(
        and(familyId === undefined ? undefined : eq(jobs.familyId, familyId), eq(aiurPhaseEvents.transition, 'rework')),
      )
      .groupBy(aiurPhaseEvents.jobId)
      .all()
      .map((row) => [row.jobId, row.count]),
  );
  const emails = await emailsFor(deps, [...new Set(rows.map((row) => row.creatorId))]);

  return rows.map(({ job, stage, stageText, game, creatorId }) => ({
    job: { ...job, stage: stage as AdminBuild['job']['stage'], stageText },
    game,
    member: { userId: creatorId, email: emails.get(creatorId) ?? null },
    retries: retries.get(job.id) ?? 0,
  }));
}
