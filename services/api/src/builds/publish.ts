import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { creditsDocumentSchema, DesignDocSchema, gameManifestSchema } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { buildDir, markComplete } from '@ogm/games-host/layout';
import { and, eq, inArray } from 'drizzle-orm';

import { budgetDefaults } from '../admin/family.js';
import type { AppDeps } from '../app/types.js';
import { switchBranchBuild } from '../design/reapply.js';
import { scanBuild } from '../gameplay/paid-integrations.js';
import { paidApisDuringGameplay } from '../gameplay/policy.js';
import { getDesignRuntime } from '../design/routes.js';
import { resolveBranch, StaleBaseRev } from '../design/store.js';
import { isTerminal } from '../jobs/state.js';
import { markTerminal } from '../jobs/spend-cap.js';
import { releaseRuntimeFor } from '../releases/routes.js';
import { registerBuild, updateBuild } from '../releases/service.js';
import { withArtifactMutation } from './artifact-lock.js';
import { BuildCacheError, completeBuildCache } from './cache-plan.js';
import { untarGz } from './untar.js';

// Jobs whose merged PR must become a playable build before the job is done; a scope job ships no build.
export const BUILD_KINDS = ['new_game', 'feature', 'repair'] as const;

const SYSTEM_ACTOR = 'system:builder';
const SWITCH_ATTEMPTS = 3;

// `.staging` never matches the games-host id pattern, so nothing under it is ever served.
const stagingRoot = (deps: AppDeps) => join(deps.config.gamesRoot, '.staging');
const stagedDir = (deps: AppDeps, jobId: string) => join(stagingRoot(deps), jobId);
const completedRoot = (deps: AppDeps) => join(deps.config.gamesRoot, '.completed');

function jobRow(deps: AppDeps, jobId: string) {
  return deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
}

export function awaitsBuild(deps: AppDeps, jobId: string): boolean {
  const job = jobRow(deps, jobId);
  return job !== undefined && (BUILD_KINDS as readonly string[]).includes(job.kind) && !isTerminal(job.state);
}

// Aiur reported the run completed (its PR merged): the build may be published once it is staged.
export function runCompleted(deps: AppDeps, jobId: string): boolean {
  const row = deps.db
    .select({ lifecycle: schema.jobProjections.lifecycle })
    .from(schema.jobProjections)
    .where(eq(schema.jobProjections.jobId, jobId))
    .get();
  return row?.lifecycle === 'completed';
}

// Unpacks the hook's archive beside the games root and swaps it in whole, replacing an earlier upload.
export async function stageArtifact(deps: AppDeps, jobId: string, gitSha: string, archive: Buffer): Promise<void> {
  const temporary = join(stagingRoot(deps), `.${jobId}.${randomUUID()}`);
  try {
    await mkdir(join(temporary, 'build'), { recursive: true });
    await untarGz(archive, join(temporary, 'build'));
    await writeFile(join(temporary, 'git-sha'), gitSha);
    await rm(stagedDir(deps, jobId), { recursive: true, force: true });
    await rename(temporary, stagedDir(deps, jobId));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export type PublishOutcome = { state: 'done'; buildId: string } | { state: 'failed'; reason: string } | null;

const publishing = new Set<string>();

export const isPublishing = (jobId: string) => publishing.has(jobId);

// Publishes a staged build: register, move into `<gamesRoot>/<gameId>/<buildId>/`, write `.complete` last, switch
// the job's branch to it, mark it tested, then finish the job. A failure before the switch removes the build and fails
// the job; once the switch has committed, the branch points at the build, so it is kept and only the failure is logged.
export async function publishStaged(deps: AppDeps, jobId: string): Promise<PublishOutcome> {
  if (publishing.has(jobId) || !awaitsBuild(deps, jobId) || !existsSync(stagedDir(deps, jobId))) return null;
  let release: ReturnType<typeof releaseRuntimeFor>;
  let design: ReturnType<typeof getDesignRuntime>;
  try {
    release = releaseRuntimeFor(deps);
    design = getDesignRuntime(deps);
  } catch {
    return null; // Routes are still being set up at startup; the sweep retries.
  }
  publishing.add(jobId);
  const job = jobRow(deps, jobId)!;
  let buildId: string | undefined;
  let target: string | undefined;
  let switched = false;
  try {
    const staged = stagedDir(deps, jobId);
    const files = join(staged, 'build');
    const manifest = gameManifestSchema.safeParse(await readJson(join(files, 'manifest.json')));
    if (!manifest.success) throw new PublishFailure('manifest_invalid');
    if (!DesignDocSchema.safeParse(await readJson(join(files, 'design', 'design.json'))).success) {
      throw new PublishFailure('design_invalid');
    }
    if (!creditsDocumentSchema.safeParse(await readJson(join(files, 'credits.json'))).success) {
      throw new PublishFailure('credits_invalid');
    }
    const integrations = await scanBuild(files);
    if (integrations.credentials.length > 0) throw new PublishFailure('provider_credential');
    if (integrations.paid.length > 0 && !paidApisDuringGameplay(deps.db)) throw new PublishFailure('paid_integration');
    const saveSchemaVersion = (manifest.data as Record<string, unknown>).saveSchemaVersion;
    const achievements = await readFile(join(files, 'achievements.json')).catch(() => Buffer.alloc(0));
    const published = await withArtifactMutation(async () => {
      const branch = resolveBranch(deps.sqlite, job.gameId, job.branchId);
      const previousBuildId = branch.latestBuildId;
      const build = registerBuild(deps, release, job.gameId, {
        branchId: branch.id,
        gitSha: (await readFile(join(staged, 'git-sha'), 'utf8')).trim(),
        jobId,
        sdkVersion: manifest.data.sdk,
        saveSchemaVersion: Number.isSafeInteger(saveSchemaVersion) ? (saveSchemaVersion as number) : 0,
        achievementCatalogHash: createHash('sha256').update(achievements).digest('hex'),
        artifactPath: join(deps.config.gamesRoot, job.gameId),
      });
      buildId = build.id;
      const buildTarget = buildDir(deps.config.gamesRoot, job.gameId, build.id);
      target = buildTarget;
      deps.db.update(schema.builds).set({ artifactPath: buildTarget }).where(eq(schema.builds.id, build.id)).run();

      await mkdir(join(deps.config.gamesRoot, job.gameId), { recursive: true });
      await completeBuildCache({
        root: deps.config.gamesRoot,
        files,
        gameId: job.gameId,
        buildId: build.id,
        previousBuildId,
        sdkVersion: manifest.data.sdk,
      });
      await rename(files, buildTarget);
      await markComplete(buildTarget);
      const switchTx = await switchToBuild(deps, design, job.gameId, branch.id, build.id);
      switched = true;
      return { branchId: branch.id, buildId: build.id, switchTx };
    });
    design.stream.publish(published.branchId, published.switchTx.transaction);
    await updateBuild(deps, release, published.buildId, 'tested');

    settle(deps, jobId, 'done');
    deps.log({ event: 'build_published', jobId, gameId: job.gameId, buildId: published.buildId });
    return { state: 'done', buildId: published.buildId };
  } catch (error) {
    const reason =
      error instanceof PublishFailure || error instanceof BuildCacheError ? error.message : errorName(error);
    if (switched && buildId) {
      settle(deps, jobId, 'done');
      deps.log({ event: 'build_publish_incomplete', jobId, gameId: job.gameId, buildId, reason });
      return { state: 'done', buildId };
    }
    if (target) await rm(target, { recursive: true, force: true }).catch(() => undefined);
    if (buildId) await updateBuild(deps, release, buildId, 'failed').catch(() => undefined);
    settle(deps, jobId, 'failed');
    deps.log({ event: 'build_publish_failed', jobId, gameId: job.gameId, reason });
    return { state: 'failed', reason };
  } finally {
    await rm(stagedDir(deps, jobId), { recursive: true, force: true });
    publishing.delete(jobId);
  }
}

// A creator's edit landing while the switch computes moves the branch head; recompute against the new head.
async function switchToBuild(
  deps: AppDeps,
  design: ReturnType<typeof getDesignRuntime>,
  gameId: string,
  branchId: string,
  buildId: string,
) {
  for (let attempt = 1; ; attempt += 1) {
    const branch = resolveBranch(deps.sqlite, gameId, branchId);
    try {
      return await switchBranchBuild(deps.sqlite, design.source, branch, buildId, { actor: SYSTEM_ACTOR, token: 0 });
    } catch (error) {
      if (!(error instanceof StaleBaseRev) || attempt === SWITCH_ATTEMPTS) throw error;
    }
  }
}

// The Aiur feed's terminal verdict for a run. A build job is done only once its merged build is playable, so a
// completed run hands it to the publisher (or leaves it for the upload or the sweep) instead of finishing it.
export function finishRun(deps: AppDeps, jobId: string, state: 'done' | 'failed' | 'cancelled'): void {
  if (state === 'done' && awaitsBuild(deps, jobId)) {
    publishStaged(deps, jobId).catch((error: unknown) =>
      deps.log({ event: 'build_publish_failed', jobId, reason: errorName(error) }),
    );
  } else markTerminal(lifecycle(deps), jobId, state, { deferRelease: true });
}

// Fails build jobs whose run completed `graceMs` ago without a build arriving, and drops staging left by jobs that
// ended some other way. The grace starts when the sweep first sees the completed run (a marker file), because the
// projection row's `updated_at` keeps moving with every poll.
export async function sweepBuilds(deps: AppDeps, graceMs: number, now = new Date()): Promise<void> {
  const completed = deps.db
    .select({ jobId: schema.jobs.id, gameId: schema.jobs.gameId, state: schema.jobs.state })
    .from(schema.jobs)
    .innerJoin(schema.jobProjections, eq(schema.jobProjections.jobId, schema.jobs.id))
    .where(and(inArray(schema.jobs.kind, [...BUILD_KINDS]), eq(schema.jobProjections.lifecycle, 'completed')))
    .all();
  await mkdir(completedRoot(deps), { recursive: true });
  for (const job of completed) {
    if (isTerminal(job.state) || publishing.has(job.jobId)) continue;
    try {
      if (existsSync(stagedDir(deps, job.jobId))) {
        await publishStaged(deps, job.jobId);
        continue;
      }
      const marker = join(completedRoot(deps), job.jobId);
      const seenAt = await readFile(marker, 'utf8').catch(() => null);
      if (seenAt === null) {
        await writeFile(marker, now.toISOString());
        continue;
      }
      const seen = Date.parse(seenAt);
      if (Number.isNaN(seen)) {
        await writeFile(marker, now.toISOString());
        continue;
      }
      if (now.getTime() - seen < graceMs) continue;
      markTerminal(lifecycle(deps), job.jobId, 'failed', { deferRelease: true });
      deps.log({ event: 'build_publish_failed', jobId: job.jobId, gameId: job.gameId, reason: 'build_not_received' });
    } catch (error) {
      deps.log({ event: 'build_sweep_failed', jobId: job.jobId, reason: errorName(error) });
    }
  }
  for (const [root, entry] of [
    ...(await readdir(stagingRoot(deps)).catch(() => [])).map((entry) => [stagingRoot(deps), entry] as const),
    ...(await readdir(completedRoot(deps)).catch(() => [])).map((entry) => [completedRoot(deps), entry] as const),
  ]) {
    // `.<jobId>.<uuid>` is an upload being unpacked; one older than the grace was cut off by a crash.
    const jobId = entry.startsWith('.') ? entry.slice(1).split('.')[0]! : entry;
    const abandoned = entry.startsWith('.')
      ? now.getTime() - (await stat(join(root, entry)).catch(() => ({ mtimeMs: now.getTime() }))).mtimeMs > graceMs
      : !awaitsBuild(deps, jobId) && !publishing.has(jobId);
    if (abandoned) await rm(join(root, entry), { recursive: true, force: true });
  }
}

export function startBuildSweep(deps: AppDeps, options: { graceMs: number; intervalMs: number }): () => void {
  const timer = setInterval(() => {
    sweepBuilds(deps, options.graceMs).catch((error: unknown) =>
      deps.log({ event: 'build_sweep_failed', reason: errorName(error) }),
    );
  }, options.intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

// A job cancelled while its build was publishing has already ended; its terminal state stands.
function settle(deps: AppDeps, jobId: string, state: 'done' | 'failed'): void {
  try {
    markTerminal(lifecycle(deps), jobId, state, { deferRelease: true });
  } catch (error) {
    deps.log({ event: 'build_job_not_settled', jobId, state, reason: errorName(error) });
  }
}

class PublishFailure extends Error {}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown_error';
}

function lifecycle(deps: AppDeps) {
  return { db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults: budgetDefaults(deps) };
}
