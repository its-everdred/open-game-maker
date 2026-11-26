import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import {
  controlDeclSchema,
  OverrideKeySchema,
  StableIdSchema,
  TransactionSchema,
  type Principal,
  type Transaction,
} from '@ogm/contracts';
import { PatchTooLargeError, validateCommands, validatePatches } from '@ogm/design-log';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody, parseQuery } from '../app/validate.js';
import { findGameForFamily, hasGameGrant, type GameRow } from '../games/games.js';
import { FsBaseDocSource, type BaseDocSource } from './base-doc.js';
import { acquireLease, heartbeatLease, LeaseMismatch, releaseLease } from './lease.js';
import {
  AnswerConflict,
  answerReport,
  BuildNotTested,
  getReport,
  ManifestInvalid,
  switchBranchBuild,
} from './reapply.js';
import { snapshotAt } from './snapshot.js';
import {
  appendTransaction,
  BranchArchived,
  BranchNotFound,
  readTransactions,
  resolveBranch,
  StaleBaseRev,
} from './store.js';
import { createDesignStreamHub, formatTransactionFrame, type DesignStreamHub } from './stream.js';

export const prefix = '/api/v1';

type DesignRuntime = { source: BaseDocSource; stream: DesignStreamHub };
const runtimes = new WeakMap<AppDeps, DesignRuntime>();

const leaseBody = z.object({ sessionId: z.string().trim().min(1).max(200) }).strict();
const fencedLeaseBody = leaseBody.extend({ token: z.number().int().positive() }).strict();
const transactionsQuery = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  format: z.literal('json').optional(),
});
const designQuery = z.object({
  rev: z.union([z.literal('head'), z.coerce.number().int().nonnegative()]).optional(),
});
const transactionBody = TransactionSchema.omit({ id: true, rev: true, createdAt: true })
  .partial({ gameId: true, branchId: true, actor: true })
  .extend({ sessionId: z.string().trim().min(1).max(200).optional() });
const answerBody = fencedLeaseBody
  .extend({
    answers: z
      .array(
        z
          .object({
            key: OverrideKeySchema,
            choice: z.enum(['use_allowed', 'keep_mine', 'discard', 'use_builder']),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const switchBody = fencedLeaseBody.extend({ buildId: StableIdSchema }).strict();

export function setup(deps: AppDeps): void {
  if (!runtimes.has(deps)) {
    runtimes.set(deps, { source: new FsBaseDocSource(deps.config.gamesRoot), stream: createDesignStreamHub() });
  }
}

export function getDesignRuntime(deps: AppDeps): DesignRuntime {
  const runtime = runtimes.get(deps);
  if (!runtime) throw new Error('design context was not set up');
  return runtime;
}

function routeParam(c: Parameters<typeof requirePrincipal>[0], name: string): string {
  const value = c.req.param(name);
  if (!value) throw new HttpError(400, 'invalid_request');
  return value;
}

function stableRouteParam(c: Parameters<typeof requirePrincipal>[0], name: string): string {
  const parsed = StableIdSchema.safeParse(routeParam(c, name));
  if (!parsed.success) throw new HttpError(400, 'invalid_request', undefined, parsed.error.issues);
  return parsed.data;
}

function invalidManifest(error: ManifestInvalid): HttpError {
  return new HttpError(422, 'build_manifest_invalid', undefined, { buildId: error.buildId });
}

function ownedGame(c: Parameters<typeof requirePrincipal>[0]): {
  principal: Extract<Principal, { kind: 'user' }>;
  game: GameRow;
} {
  const principal = requirePrincipal(c, ['user']);
  const game = findGameForFamily(c.get('deps').db, routeParam(c, 'gameId'), principal.familyId);
  requireAuthorization(
    authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
  );
  return { principal, game };
}

function readableGame(c: Parameters<typeof requirePrincipal>[0]): GameRow {
  const principal = requirePrincipal(c, ['user']);
  const game = findGameForFamily(c.get('deps').db, routeParam(c, 'gameId'), principal.familyId);
  requireAuthorization(
    authorize(actorFromPrincipal(principal), 'game.play', {
      familyId: game.familyId,
      ownerId: game.ownerId,
      visibility: game.visibility,
      releaseState: game.releaseState,
      granted: hasGameGrant(c.get('deps').db, game.id, principal.userId),
    }),
  );
  return game;
}

function branchFor(c: Parameters<typeof requirePrincipal>[0], gameId: string) {
  try {
    return resolveBranch(c.get('deps').sqlite, gameId, routeParam(c, 'branch'));
  } catch (error) {
    if (error instanceof BranchNotFound) throw new HttpError(404, 'branch_not_found');
    throw error;
  }
}

function validateBodyPath(
  body: z.output<typeof transactionBody>,
  gameId: string,
  branchId: string,
  branchName: string,
) {
  if (body.gameId !== undefined && body.gameId !== gameId) throw new HttpError(400, 'game_mismatch');
  if (body.branchId !== undefined && body.branchId !== branchId && body.branchId !== branchName) {
    throw new HttpError(400, 'branch_mismatch');
  }
}

async function validateTransaction(
  deps: AppDeps,
  runtime: DesignRuntime,
  branch: ReturnType<typeof resolveBranch>,
  body: z.output<typeof transactionBody>,
): Promise<void> {
  try {
    for (const [field, value] of [
      ['patches', body.patches],
      ['inverse', body.inverse],
    ] as const) {
      const result = validatePatches(value);
      if (!result.ok) {
        const errors = result.errors.map((error) => ({ ...error, path: error.path.replace(/^patches/, field) }));
        throw new HttpError(422, 'invalid_transaction', undefined, errors);
      }
    }
  } catch (error) {
    if (error instanceof PatchTooLargeError) throw new HttpError(413, 'patch_too_large');
    throw error;
  }

  if (branch.latestBuildId === null || body.commands.length === 0) return;
  const { doc } = await snapshotAt(deps.sqlite, runtime.source, branch.id, branch.headRev);
  const manifest = await runtime.source.manifest(branch.gameId, branch.latestBuildId);
  const controlsResult = z.array(controlDeclSchema).safeParse((manifest as Record<string, unknown>).controls ?? []);
  if (!controlsResult.success) throw new HttpError(422, 'invalid_transaction', undefined, controlsResult.error.issues);
  const commands = validateCommands(controlsResult.data, doc, body.commands);
  if (!commands.ok) throw new HttpError(422, 'invalid_transaction', undefined, commands.errors);
}

function effectiveAfter(c: Parameters<typeof parseQuery>[0], queryAfter: number): number {
  const lastEventId = c.req.header('last-event-id');
  if (lastEventId === undefined || !/^\d+$/.test(lastEventId)) return queryAfter;
  return Math.max(queryAfter, Number(lastEventId));
}

function transactionStream(
  c: Parameters<typeof streamSSE>[0],
  branchId: string,
  after: number,
  deps: AppDeps,
  hub: DesignStreamHub,
) {
  return streamSSE(c, async (stream) => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let queue: Promise<unknown> = Promise.resolve();
    let live = false;
    let lastSent = after;
    const pending: Transaction[] = [];
    const write = (transaction: Transaction) => {
      if (transaction.rev <= lastSent) return;
      lastSent = transaction.rev;
      queue = queue.then(async () => stream.write(formatTransactionFrame(transaction)));
      void queue.catch(finish);
    };
    const detach = hub.subscribe(branchId, (transaction) => {
      if (live) write(transaction);
      else pending.push(transaction);
    });

    try {
      for (const transaction of readTransactions(deps.sqlite, branchId, after, Number.MAX_SAFE_INTEGER)) {
        write(transaction);
      }
      live = true;
      for (const transaction of [...pending].sort((left, right) => left.rev - right.rev)) write(transaction);
      stream.onAbort(finish);
      const keepalive = setInterval(() => {
        queue = queue.then(async () => stream.write(': ping\n\n'));
        void queue.catch(finish);
      }, 25_000);
      keepalive.unref();
      try {
        await queue;
        await finished;
      } finally {
        clearInterval(keepalive);
      }
    } finally {
      detach();
    }
  });
}

const routes = new Hono<ApiBindings>()
  .post('/games/:gameId/branches/:branch/lease', async (c) => {
    const { principal, game } = ownedGame(c);
    const body = await parseBody(c, leaseBody);
    const branch = branchFor(c, game.id);
    return c.json(
      acquireLease(c.get('deps').sqlite, {
        gameId: game.id,
        branchId: branch.id,
        userId: principal.userId,
        sessionId: body.sessionId,
      }),
    );
  })
  .post('/games/:gameId/branches/:branch/lease/heartbeat', async (c) => {
    const { principal, game } = ownedGame(c);
    const body = await parseBody(c, fencedLeaseBody);
    const branch = branchFor(c, game.id);
    try {
      return c.json(
        heartbeatLease(c.get('deps').sqlite, {
          gameId: game.id,
          branchId: branch.id,
          userId: principal.userId,
          sessionId: body.sessionId,
          token: body.token,
        }),
      );
    } catch (error) {
      if (error instanceof LeaseMismatch) return c.json({ holder: 'other-session' }, 423);
      throw error;
    }
  })
  .delete('/games/:gameId/branches/:branch/lease', async (c) => {
    const { principal, game } = ownedGame(c);
    const body = await parseBody(c, fencedLeaseBody);
    const branch = branchFor(c, game.id);
    const released = releaseLease(c.get('deps').sqlite, {
      gameId: game.id,
      branchId: branch.id,
      userId: principal.userId,
      sessionId: body.sessionId,
      token: body.token,
    });
    return released ? c.body(null, 204) : c.json({ holder: 'other-session' }, 423);
  })
  .post('/games/:gameId/branches/:branch/transactions', async (c) => {
    const principal = requirePrincipal(c, ['user', 'service']);
    const body = await parseBody(c, transactionBody);
    const deps = c.get('deps');
    let gameId = routeParam(c, 'gameId');
    let actor: string;
    if (principal.kind === 'user') {
      const game = ownedGame(c).game;
      gameId = game.id;
      actor = principal.userId;
      if (body.kind !== 'manual') throw new HttpError(403, 'forbidden');
      if (body.actor !== undefined && body.actor !== actor) throw new HttpError(400, 'actor_mismatch');
    } else {
      if (body.kind === 'manual' || body.leaseToken !== 0) throw new HttpError(403, 'forbidden');
      const parsedActor = StableIdSchema.safeParse(body.actor);
      if (!parsedActor.success) throw new HttpError(400, 'invalid_actor');
      actor = parsedActor.data;
    }
    const branch = branchFor(c, gameId);
    validateBodyPath(body, gameId, branch.id, routeParam(c, 'branch'));
    const runtime = getDesignRuntime(deps);
    await validateTransaction(deps, runtime, branch, body);

    try {
      const transaction = appendTransaction(deps.sqlite, {
        gameId,
        branchId: branch.id,
        baseRev: body.baseRev,
        leaseToken: body.leaseToken,
        actor,
        kind: body.kind,
        label: body.label,
        baseBuildId: body.baseBuildId,
        commands: body.commands,
        patches: body.patches,
        inverse: body.inverse,
        sessionId: body.sessionId,
      });
      runtime.stream.publish(branch.id, transaction);
      return c.json({ rev: transaction.rev });
    } catch (error) {
      if (error instanceof StaleBaseRev) return c.json({ headRev: error.headRev }, 409);
      if (error instanceof LeaseMismatch) return c.json({ holder: 'other-session' }, 423);
      if (error instanceof BranchArchived) return c.json({ error: 'branch_archived' }, 409);
      throw error;
    }
  })
  .get('/games/:gameId/branches/:branch/transactions', (c) => {
    const game = readableGame(c);
    const branch = branchFor(c, game.id);
    const query = parseQuery(c, transactionsQuery);
    const after = effectiveAfter(c, query.after);
    if (query.format === 'json') {
      return c.json(readTransactions(c.get('deps').sqlite, branch.id, after, Number.MAX_SAFE_INTEGER));
    }
    return transactionStream(c, branch.id, after, c.get('deps'), getDesignRuntime(c.get('deps')).stream);
  })
  .get('/games/:gameId/branches/:branch/design', async (c) => {
    const game = readableGame(c);
    const branch = branchFor(c, game.id);
    const query = parseQuery(c, designQuery);
    return c.json(
      await snapshotAt(
        c.get('deps').sqlite,
        getDesignRuntime(c.get('deps')).source,
        branch.id,
        query.rev === 'head' ? undefined : query.rev,
      ),
    );
  })
  /* One build's own design, so a link to a reviewed build plays that build rather than the branch head. */
  .get('/games/:gameId/builds/:buildId/design', async (c) => {
    const game = readableGame(c);
    const buildId = stableRouteParam(c, 'buildId');
    let doc;
    try {
      doc = await getDesignRuntime(c.get('deps')).source.load(game.id, buildId);
    } catch {
      throw new HttpError(404, 'build_not_found');
    }
    return c.json({ rev: 0, buildId, doc });
  })
  .get('/games/:gameId/branches/:branch/reapply/:buildId', async (c) => {
    const game = readableGame(c);
    const branch = branchFor(c, game.id);
    const buildId = stableRouteParam(c, 'buildId');
    try {
      return c.json(await getReport(c.get('deps').sqlite, getDesignRuntime(c.get('deps')).source, branch.id, buildId));
    } catch (error) {
      if (error instanceof ManifestInvalid) throw invalidManifest(error);
      if (error instanceof StaleBaseRev) return c.json({ headRev: error.headRev }, 409);
      throw error;
    }
  })
  .post('/games/:gameId/branches/:branch/reapply/:buildId/answers', async (c) => {
    const { principal, game } = ownedGame(c);
    const branch = branchFor(c, game.id);
    const buildId = stableRouteParam(c, 'buildId');
    const body = await parseBody(c, answerBody);
    const runtime = getDesignRuntime(c.get('deps'));
    try {
      const transactions = await answerReport(c.get('deps').sqlite, runtime.source, branch, buildId, body.answers, {
        actor: principal.userId,
        sessionId: body.sessionId,
        token: body.token,
      });
      transactions.forEach((transaction) => runtime.stream.publish(branch.id, transaction));
      return c.json({ rev: transactions.at(-1)!.rev });
    } catch (error) {
      if (error instanceof AnswerConflict) throw new HttpError(409, 'answer_conflict');
      if (error instanceof LeaseMismatch) return c.json({ holder: 'other-session' }, 423);
      if (error instanceof StaleBaseRev) return c.json({ headRev: error.headRev }, 409);
      if (error instanceof ManifestInvalid) throw invalidManifest(error);
      throw error;
    }
  })
  .post('/games/:gameId/branches/:branch/switch', async (c) => {
    const { principal, game } = ownedGame(c);
    const branch = branchFor(c, game.id);
    const body = await parseBody(c, switchBody);
    const runtime = getDesignRuntime(c.get('deps'));
    try {
      const switched = await switchBranchBuild(c.get('deps').sqlite, runtime.source, branch, body.buildId, {
        actor: principal.userId,
        sessionId: body.sessionId,
        token: body.token,
      });
      runtime.stream.publish(branch.id, switched.transaction);
      return c.json({ rev: switched.transaction.rev, report: switched.report });
    } catch (error) {
      if (error instanceof BuildNotTested) throw new HttpError(409, 'build_not_tested');
      if (error instanceof LeaseMismatch) return c.json({ holder: 'other-session' }, 423);
      if (error instanceof StaleBaseRev) return c.json({ headRev: error.headRev }, 409);
      if (error instanceof ManifestInvalid) throw invalidManifest(error);
      throw error;
    }
  });

export default routes;
