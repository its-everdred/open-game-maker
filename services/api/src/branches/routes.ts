import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';

import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import { getDesignRuntime } from '../design/routes.js';
import { BranchArchived, BranchNotFound } from '../design/store.js';
import { LeaseMismatch } from '../design/lease.js';
import { findGameForFamily, hasGameGrant, type GameRow } from '../games/games.js';
import { InvalidResolution, PatchTooLargeError, UnresolvedConflict } from '@ogm/design-log';
import {
  InvalidBranchPair,
  MergeBuildMissing,
  MergePlanNotFound,
  TargetMoved,
  WrongMergeStatus,
  abandonMergePlan,
  createMergePlan,
  getMergePlan,
  landMergePlan,
  previewMergePlan,
  resolveAllMergeConflicts,
  resolveMergeConflict,
  rollbackMergePlan,
} from './merge.js';
import {
  CapActive,
  InvalidBranchName,
  MainImmutable,
  NameTaken,
  archiveBranch,
  createBranch,
  getBranch,
  listBranches,
  renameBranch,
} from './service.js';
import { createVersionCounts } from './version-counts.js';
import { resolveSceneryCommit } from '../scenery/source.js';

export const prefix = '/api/v1';

const createBody = z.object({ name: z.string(), fromBranchId: z.string().min(1).optional() }).strict();
const renameBody = z.object({ name: z.string() }).strict();
const createMergeBody = z.object({ sourceBranchId: z.string().min(1) }).strict();
const resolutionSchema = z.union([z.enum(['ours', 'theirs', 'both']), z.object({ value: z.unknown() }).strict()]);
const resolveMergeBody = z.object({ resolution: resolutionSchema }).strict();
const resolveAllBody = z.object({ resolution: z.enum(['ours', 'theirs']) }).strict();
const mergeLeaseBody = z
  .object({ sessionId: z.string().trim().min(1).max(200), token: z.number().int().positive() })
  .strict();

function routeParam(c: Context<ApiBindings>, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(400, 'invalid_request');
  return value;
}

function authorizedGame(c: Context<ApiBindings>, action: 'game.edit' | 'game.play'): { game: GameRow; userId: string } {
  const principal = requirePrincipal(c, ['user']);
  const game = findGameForFamily(c.get('deps').db, routeParam(c, 'gameId'), principal.familyId);
  requireAuthorization(
    authorize(
      actorFromPrincipal(principal),
      action,
      action === 'game.edit'
        ? { familyId: game.familyId, ownerId: game.ownerId }
        : {
            familyId: game.familyId,
            ownerId: game.ownerId,
            visibility: game.visibility,
            granted: hasGameGrant(c.get('deps').db, game.id, principal.userId),
          },
    ),
  );
  return { game, userId: principal.userId };
}

function branchError(c: Context<ApiBindings>, error: unknown): Response {
  if (error instanceof CapActive) return c.json({ error: 'cap_active', active: error.active }, 409);
  if (error instanceof NameTaken) return c.json({ error: 'name_taken' }, 409);
  if (error instanceof InvalidBranchName) return c.json({ error: 'invalid_branch_name' }, 422);
  if (error instanceof MainImmutable) return c.json({ error: 'main_immutable' }, 409);
  if (error instanceof BranchArchived) return c.json({ error: 'branch_archived' }, 409);
  if (error instanceof BranchNotFound) return c.json({ error: 'branch_not_found' }, 404);
  throw error;
}

function mergeError(c: Context<ApiBindings>, error: unknown): Response {
  if (error instanceof UnresolvedConflict) return c.json({ error: 'unresolved_conflict' }, 409);
  if (error instanceof InvalidResolution) return c.json({ error: 'invalid_resolution' }, 422);
  if (error instanceof TargetMoved) return c.json({ error: 'target_moved' }, 409);
  if (error instanceof WrongMergeStatus) return c.json({ error: 'wrong_status', status: error.status }, 409);
  if (error instanceof InvalidBranchPair) return c.json({ error: 'invalid_branch_pair' }, 409);
  if (error instanceof MergePlanNotFound) return c.json({ error: 'merge_plan_not_found' }, 404);
  if (error instanceof MergeBuildMissing) return c.json({ error: 'merge_build_missing' }, 409);
  if (error instanceof PatchTooLargeError) throw new HttpError(413, 'patch_too_large');
  if (error instanceof LeaseMismatch) return c.json({ holder: 'other-session' }, 423);
  return branchError(c, error);
}

function planForTarget(c: Context<ApiBindings>, gameId: string) {
  const target = getBranch(c.get('deps').sqlite, gameId, routeParam(c, 'branchId'));
  const plan = getMergePlan(c.get('deps').sqlite, gameId, routeParam(c, 'planId'));
  if (plan.targetBranchId !== target.id) throw new MergePlanNotFound();
  return plan;
}

const routes = new Hono<ApiBindings>()
  .post('/games/:gameId/branches', async (c) => {
    const { game, userId } = authorizedGame(c, 'game.edit');
    const body = await parseBody(c, createBody);
    try {
      const deps = c.get('deps');
      const parent = getBranch(deps.sqlite, game.id, body.fromBranchId ?? 'main');
      const daemon = game.slug
        ? deps.db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug)).get()
        : undefined;
      let forkGitSha: string | undefined;
      if (daemon && game.githubPath) {
        const ref = parent.name === 'main' ? 'HEAD' : parent.gitRef;
        forkGitSha = await resolveSceneryCommit(daemon.checkoutPath, game.githubPath, ref).catch(
          () => parent.forkPoint?.gitSha ?? undefined,
        );
      }
      return c.json(
        createBranch(c.get('deps').sqlite, {
          gameId: game.id,
          name: body.name,
          fromBranchId: body.fromBranchId,
          userId,
          forkGitSha,
        }),
        201,
      );
    } catch (error) {
      return branchError(c, error);
    }
  })
  .get('/games/:gameId/branches', async (c) => {
    const { game } = authorizedGame(c, 'game.play');
    const counts = createVersionCounts(c.get('deps').sqlite);
    const branches = await Promise.all(
      listBranches(c.get('deps').sqlite, game.id).map(async (branch) => ({
        ...branch,
        version: await counts.versionFor(branch),
      })),
    );
    return c.json({ branches });
  })
  .get('/games/:gameId/branches/:branchId', async (c) => {
    const { game } = authorizedGame(c, 'game.play');
    try {
      const branch = getBranch(c.get('deps').sqlite, game.id, routeParam(c, 'branchId'));
      const version = await createVersionCounts(c.get('deps').sqlite).versionFor(branch);
      return c.json({ ...branch, version });
    } catch (error) {
      return branchError(c, error);
    }
  })
  .patch('/games/:gameId/branches/:branchId', async (c) => {
    const { game } = authorizedGame(c, 'game.edit');
    const body = await parseBody(c, renameBody);
    try {
      return c.json(renameBranch(c.get('deps').sqlite, game.id, routeParam(c, 'branchId'), body.name));
    } catch (error) {
      return branchError(c, error);
    }
  })
  .post('/games/:gameId/branches/:branchId/archive', (c) => {
    const { game } = authorizedGame(c, 'game.edit');
    try {
      return c.json(archiveBranch(c.get('deps').sqlite, game.id, routeParam(c, 'branchId')));
    } catch (error) {
      return branchError(c, error);
    }
  })
  .post('/games/:gameId/branches/:branchId/merges', async (c) => {
    const { game } = authorizedGame(c, 'game.edit');
    const body = await parseBody(c, createMergeBody);
    try {
      const target = getBranch(c.get('deps').sqlite, game.id, routeParam(c, 'branchId'));
      return c.json(
        await createMergePlan(c.get('deps').sqlite, getDesignRuntime(c.get('deps')).source, {
          gameId: game.id,
          sourceBranchId: body.sourceBranchId,
          targetBranchId: target.id,
        }),
        201,
      );
    } catch (error) {
      return mergeError(c, error);
    }
  })
  .get('/games/:gameId/branches/:branchId/merges/:planId', (c) => {
    const { game } = authorizedGame(c, 'game.edit');
    try {
      return c.json(planForTarget(c, game.id));
    } catch (error) {
      return mergeError(c, error);
    }
  })
  .post('/games/:gameId/branches/:branchId/merges/:planId/conflicts/:conflictId', async (c) => {
    const { game } = authorizedGame(c, 'game.edit');
    const body = await parseBody(c, resolveMergeBody);
    try {
      planForTarget(c, game.id);
      return c.json(
        resolveMergeConflict(
          c.get('deps').sqlite,
          game.id,
          routeParam(c, 'planId'),
          routeParam(c, 'conflictId'),
          body.resolution,
        ),
      );
    } catch (error) {
      return mergeError(c, error);
    }
  })
  .post('/games/:gameId/branches/:branchId/merges/:planId/resolve-all', async (c) => {
    const { game } = authorizedGame(c, 'game.edit');
    const body = await parseBody(c, resolveAllBody);
    try {
      planForTarget(c, game.id);
      return c.json(resolveAllMergeConflicts(c.get('deps').sqlite, game.id, routeParam(c, 'planId'), body.resolution));
    } catch (error) {
      return mergeError(c, error);
    }
  })
  .post('/games/:gameId/branches/:branchId/merges/:planId/preview', async (c) => {
    const { game } = authorizedGame(c, 'game.edit');
    try {
      planForTarget(c, game.id);
      return c.json(
        await previewMergePlan(
          c.get('deps').sqlite,
          getDesignRuntime(c.get('deps')).source,
          game.id,
          routeParam(c, 'planId'),
        ),
      );
    } catch (error) {
      return mergeError(c, error);
    }
  })
  .post('/games/:gameId/branches/:branchId/merges/:planId/land', async (c) => {
    const { game, userId } = authorizedGame(c, 'game.edit');
    const body = await parseBody(c, mergeLeaseBody);
    try {
      planForTarget(c, game.id);
      const transaction = await landMergePlan(
        c.get('deps').sqlite,
        getDesignRuntime(c.get('deps')).source,
        game.id,
        routeParam(c, 'planId'),
        { actor: userId, sessionId: body.sessionId, token: body.token },
      );
      getDesignRuntime(c.get('deps')).stream.publish(transaction.branchId, transaction);
      return c.json({ rev: transaction.rev });
    } catch (error) {
      return mergeError(c, error);
    }
  })
  .post('/games/:gameId/branches/:branchId/merges/:planId/abandon', (c) => {
    const { game } = authorizedGame(c, 'game.edit');
    try {
      planForTarget(c, game.id);
      return c.json(abandonMergePlan(c.get('deps').sqlite, game.id, routeParam(c, 'planId')));
    } catch (error) {
      return mergeError(c, error);
    }
  })
  .post('/games/:gameId/branches/:branchId/merges/:planId/rollback', async (c) => {
    const { game, userId } = authorizedGame(c, 'game.edit');
    const body = await parseBody(c, mergeLeaseBody);
    try {
      planForTarget(c, game.id);
      const transaction = rollbackMergePlan(c.get('deps').sqlite, game.id, routeParam(c, 'planId'), {
        actor: userId,
        sessionId: body.sessionId,
        token: body.token,
      });
      getDesignRuntime(c.get('deps')).stream.publish(transaction.branchId, transaction);
      return c.json({ rev: transaction.rev });
    } catch (error) {
      return mergeError(c, error);
    }
  });

export default routes;
