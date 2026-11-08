import { randomUUID } from 'node:crypto';

import type { JobPlan, Reservation } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { budgetDefaults } from '../admin/family.js';
import type { AppDeps } from '../app/types.js';
import { type PublishOutcome, publishStaged, stageArtifact } from '../builds/publish.js';
import { BadArchive } from '../builds/untar.js';
import type { GameRow } from '../games/games.js';
import { markTerminal } from '../jobs/spend-cap.js';

// The operator's publish job carries this creator id. It is shaped like a user id (`Id`) so the job reads like any
// other in the game's history, and no user row carries it, so it never matches a member filter or an inbox.
export const PUBLISH_ACTOR = 'u_00000000-0000-4000-8000-000000000000';

export type PublishResult =
  | { state: 'done'; jobId: string; buildId: string }
  | { state: 'failed'; jobId: string; reason: string }
  | { state: 'refused'; jobId: string; reason: string };

// A registered game whose own tickets are not Game Maker jobs never stages a build through the daemon's
// `before_remove` hook, so the publisher has nothing to publish. The operator's path stands in for that upload: it
// writes the job row the publisher needs, stages the archive the operator built and hands both to `publishStaged`, so
// the build lands in the same release history as a merged agent build.
//
// The row is written `filed` with `releasedAt` set: the publisher needs a job that has not finished, while the
// instance must not count an operator action against a family's job slot or its daemon's concurrency. A publish that
// throws before the publisher settles the row is settled here instead, so a refused archive leaves nothing behind.
export function createPublishJob(deps: AppDeps, game: GameRow, gitSha: string): string {
  const at = new Date().toISOString();
  const id = `j_${randomUUID()}`;
  const plan: JobPlan = {
    title: `Publish ${game.title} at ${gitSha.slice(0, 12)}`,
    summary: 'Operator publish of a build for a registered game, staged and published through the build publisher.',
    scope: { included: [`games/${game.slug ?? game.id} at ${gitSha}`], excluded: [] },
    tickets: [
      {
        key: 'P1',
        skills: ['gm-build'],
        dependsOn: [],
        acceptanceCriteria: ['the staged build is served from the game page'],
      },
    ],
  };
  const reservation: Reservation = { amountMicroUsd: 0, sizeClass: 'small', confidence: 'low' };
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId: game.id,
      branchId: 'main',
      familyId: game.familyId,
      creatorId: PUBLISH_ACTOR,
      kind: 'feature',
      complexity: 1,
      state: 'filed',
      start: 'now',
      startAt: null,
      slot: 'edit',
      plan: JSON.stringify(plan),
      reservation: JSON.stringify(reservation),
      hardCapMicroUsd: 0,
      usageMicroUsd: 0,
      releasedAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return id;
}

export async function publishArchive(
  deps: AppDeps,
  game: GameRow,
  gitSha: string,
  archive: Buffer,
): Promise<PublishResult> {
  const jobId = createPublishJob(deps, game, gitSha);
  try {
    await stageArtifact(deps, jobId, gitSha, archive);
  } catch (error) {
    settle(deps, jobId);
    if (error instanceof BadArchive) return { state: 'refused', jobId, reason: error.message };
    throw error;
  }
  let outcome: PublishOutcome;
  try {
    outcome = await publishStaged(deps, jobId);
  } catch (error) {
    // The publisher settles its own failures; this covers a throw outside its try, so the row never stays unfinished.
    settle(deps, jobId);
    throw error;
  }
  if (outcome === null) {
    // The staged directory the publisher reads is gone; the row would otherwise sit unfinished forever.
    settle(deps, jobId);
    return { state: 'failed', jobId, reason: 'publish_not_started' };
  }
  return outcome.state === 'done'
    ? { state: 'done', jobId, buildId: outcome.buildId }
    : { state: 'failed', jobId, reason: outcome.reason };
}

// The publisher's own failure path already settles the row; this covers the paths that never reach it.
function settle(deps: AppDeps, jobId: string): void {
  try {
    const row = deps.db.select({ state: schema.jobs.state }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
    if (row === undefined || row.state === 'done' || row.state === 'failed' || row.state === 'cancelled') return;
    markTerminal(
      { db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults: budgetDefaults(deps) },
      jobId,
      'failed',
      { deferRelease: true },
    );
  } catch (error) {
    deps.log({
      event: 'publish_job_not_settled',
      jobId,
      reason: error instanceof Error ? error.name : 'unknown_error',
    });
  }
}
