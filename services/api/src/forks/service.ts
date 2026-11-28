import { mkdir, realpath, rmdir, symlink, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import { gameFolder, type BoundaryVerdict, type Build, type CommitOp, type CommitResult } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { buildDir } from '@ogm/games-host/layout';
import { authorize, type Actor } from '@ogm/policy';
import { and, eq } from 'drizzle-orm';

import { copyCatalog } from '../achievements/catalog.js';
import type { AppDeps } from '../app/types.js';
import { ensureMainBranch, stableId } from '../design/store.js';
import { getGameAccess } from '../games/games.js';
import { assignSlug } from '../games/slug.js';
import { CommitUnavailable } from '../releases/commit-client.js';
import type { RightsReason } from '../releases/rights.js';
import type { ReleaseRuntime } from '../releases/service.js';

type BuildRow = typeof schema.builds.$inferSelect;

export class ForkError extends Error {
  constructor(
    readonly code: string,
    readonly status: 403 | 404 | 409 | 422 | 502,
    readonly payload?: { verdict: BoundaryVerdict } | { rights: RightsReason[] },
  ) {
    super(code);
    this.name = 'ForkError';
  }
}

export type ForkResult = {
  game: {
    id: string;
    name: string;
    ownerId: string;
    visibility: 'public' | 'private';
    forkedFrom: { gameId: string; releaseId: string };
  };
  build: Build;
  release: null;
};

function buildResponse(row: BuildRow): Build {
  return {
    id: row.id,
    gameId: row.gameId,
    branchId: row.branchId,
    gitSha: row.gitSha,
    ...(row.jobId ? { jobId: row.jobId } : {}),
    sdkVersion: row.sdkVersion,
    saveSchemaVersion: row.saveSchemaVersion,
    ...(row.migratesFromSchema === null ? {} : { migratesFromSchema: row.migratesFromSchema }),
    achievementCatalogHash: row.achievementCatalogHash,
    status: row.status,
    artifact: row.artifact,
    createdAt: row.createdAt,
  };
}

function requireGame(deps: AppDeps, sourceGameId: string) {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, sourceGameId)).get();
  if (!game) throw new ForkError('game_not_found', 404);
  return game;
}

function requireRelease(deps: AppDeps, sourceGameId: string, releaseId: string) {
  const release = deps.db
    .select()
    .from(schema.releases)
    .where(and(eq(schema.releases.id, releaseId), eq(schema.releases.gameId, sourceGameId)))
    .get();
  if (!release) throw new ForkError('release_not_found', 404);
  const build = deps.db
    .select()
    .from(schema.builds)
    .where(and(eq(schema.builds.id, release.buildId), eq(schema.builds.gameId, sourceGameId)))
    .get();
  const snapshot = deps.db
    .select()
    .from(schema.overrideSnapshots)
    .where(and(eq(schema.overrideSnapshots.id, release.snapshotId), eq(schema.overrideSnapshots.gameId, sourceGameId)))
    .get();
  const foldSha = snapshot?.foldSha;
  if (!build || build.artifact !== 'present' || !foldSha) {
    throw new ForkError('release_incomplete', 409);
  }
  return { release, build, foldSha };
}

async function executeFork(runtime: ReleaseRuntime, operation: Extract<CommitOp, { kind: 'create_game' }>) {
  let result: CommitResult;
  try {
    result = await runtime.commit.execute(operation);
  } catch (error) {
    if (!(error instanceof CommitUnavailable)) throw error;
    result = await runtime.commit.execute(operation);
  }
  if (!result.ok) throw new ForkError('gate_refused', 502, { verdict: result.verdict });
  return result;
}

async function aliasArtifact(
  gamesRoot: string,
  sourceArtifactPath: string,
  gameId: string,
  buildId: string,
): Promise<() => Promise<void>> {
  const source = await realpath(sourceArtifactPath);
  const target = buildDir(gamesRoot, gameId, buildId);
  const gameDirectory = dirname(target);
  await mkdir(gameDirectory, { recursive: true });
  await symlink(source, target, 'dir');
  return async () => {
    await unlink(target).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    await rmdir(gameDirectory).catch((error: unknown) => {
      if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    });
  };
}

export async function forkGame(
  deps: AppDeps,
  runtime: ReleaseRuntime,
  input: {
    sourceGameId: string;
    releaseId: string;
    visibility: 'public' | 'private';
    name?: string;
    actor: Actor;
  },
): Promise<ForkResult> {
  const sourceGame = requireGame(deps, input.sourceGameId);
  const authorization = authorize(input.actor, 'game.fork', {
    familyId: sourceGame.familyId,
    ownerId: sourceGame.ownerId,
    visibility: sourceGame.visibility,
    releaseState: sourceGame.releaseState,
    gameAccess: getGameAccess(deps.db, sourceGame.id, input.actor.userId),
  });
  if (!authorization.ok) throw new ForkError(authorization.reason, 403);
  if (!sourceGame.forkable) throw new ForkError('not_forkable', 403);
  const source = requireRelease(deps, sourceGame.id, input.releaseId);

  const rights = await runtime.checkRights(source.build.artifactPath, input.visibility);
  if (rights.length) throw new ForkError('rights', 422, { rights });

  const createdAt = runtime.now().toISOString();
  const gameId = stableId('g', runtime.now());
  const branchId = stableId('b', runtime.now());
  const buildId = stableId('build', runtime.now());
  const title = input.name ?? `${sourceGame.title} (fork)`;
  const slug = assignSlug(deps.db, title);
  const path = gameFolder(slug);
  const { owner, name } = deps.config.instanceRepo;
  const game: typeof schema.games.$inferInsert = {
    id: gameId,
    familyId: input.actor.familyId,
    ownerId: input.actor.userId,
    title,
    slug,
    visibility: 'private',
    repoVisibility: input.visibility,
    githubOwner: owner,
    githubRepo: name,
    githubPath: path,
    repoUrl: `https://github.com/${owner}/${name}`,
    forkedFromGameId: sourceGame.id,
    forkedFromReleaseId: source.release.id,
    createdAt,
  };
  // The registry row has to exist first: the commit service reads the new game's folder from it.
  deps.db.insert(schema.games).values(game).run();
  let result: { sha: string };
  try {
    result = await executeFork(runtime, {
      kind: 'create_game',
      gameId,
      slug,
      templateRef: deps.config.gameTemplateRef,
      visibility: input.visibility,
      from: { gameId: sourceGame.id, sha: source.foldSha },
    });
  } catch (error) {
    deps.db.delete(schema.games).where(eq(schema.games.id, gameId)).run();
    throw error;
  }
  const build: typeof schema.builds.$inferInsert = {
    id: buildId,
    gameId,
    branchId,
    gitSha: result.sha,
    sdkVersion: source.build.sdkVersion,
    saveSchemaVersion: source.build.saveSchemaVersion,
    migratesFromSchema: source.build.migratesFromSchema,
    achievementCatalogHash: source.build.achievementCatalogHash,
    status: 'tested',
    artifact: 'present',
    artifactPath: source.build.artifactPath,
    createdAt,
  };
  const cleanupArtifact = await aliasArtifact(deps.config.gamesRoot, source.build.artifactPath, gameId, buildId);
  try {
    deps.db.transaction((tx) => {
      const branch = ensureMainBranch(deps.sqlite, gameId, { id: branchId, now: new Date(createdAt) });
      tx.insert(schema.builds).values(build).run();
      tx.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, branch.id)).run();
      copyCatalog(deps.db, sourceGame.id, gameId, source.release.id, createdAt, source.release.id);
    });
  } catch (error) {
    await cleanupArtifact();
    throw error;
  }

  return {
    game: {
      id: gameId,
      name: title,
      ownerId: input.actor.userId,
      visibility: input.visibility,
      forkedFrom: { gameId: sourceGame.id, releaseId: source.release.id },
    },
    build: buildResponse(build as BuildRow),
    release: null,
  };
}
