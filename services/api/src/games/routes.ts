import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { invalidateArtifactGrants } from '../artifacts/session-grants.js';
import { z } from 'zod';

import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { and, count, eq, inArray, lt, sql } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { sameSecret } from '../app/internal-auth.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import {
  GameProvisioningOutcomeUnknown,
  createGameRow,
  findGame,
  findGameForFamily,
  gameResponse,
  hasGameGrant,
  isGameProvisioning,
  listGames,
  provisionGame,
} from './games.js';
import { gameMedia } from './media.js';
import { gameStats } from './stats.js';
import { assignSlug, findGameBySlugOrId } from './slug.js';
import { CommitServiceRepoProvisioner } from './repo-provisioner.js';
import { readQaState } from '../qa/state.js';
import { budgetDefaults } from '../admin/family.js';
import { getBudgetSettings } from '../budget/settings.js';
import { newGameDailyUsage } from '../jobs/new-game-daily-limit.js';

export const prefix = '/api/v1';

async function commitAuditIds(deps: AppDeps): Promise<string[]> {
  try {
    const response = await fetch(
      `${deps.config.commitInternalUrl.replace(/\/$/u, '')}/internal/admin/games/failed-create-audits`,
      {
        headers: { 'x-ogm-internal': deps.config.internalToken, 'x-ogm-service': 'commit' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error('audit lookup failed');
    const body = (await response.json().catch(() => null)) as { gameIds?: unknown } | null;
    if (!Array.isArray(body?.gameIds) || body.gameIds.some((id) => typeof id !== 'string'))
      throw new Error('invalid audit response');
    return body.gameIds as string[];
  } catch {
    throw new HttpError(503, 'create_audit_unavailable');
  }
}

export async function failedCreateCandidates(deps: AppDeps) {
  // The commit service only includes creates whose repository lookup failed, so no remote game folder was reachable.
  const auditedIds = await commitAuditIds(deps);
  return auditedIds.flatMap((id) => failedCreateCandidate(deps, id));
}

function failedCreateCandidate(deps: AppDeps, id: string) {
  const game = deps.db.select().from(schema.games).where(eq(schema.games.id, id)).get();
  if (!game || game.repoUrl !== null || game.githubOwner !== null || game.githubRepo !== null) return [];
  const release = deps.db
    .select({ id: schema.releases.id })
    .from(schema.releases)
    .where(eq(schema.releases.gameId, id))
    .get();
  const job = deps.db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.gameId, id)).get();
  const scope = deps.db
    .select({ id: schema.scopeSessions.id })
    .from(schema.scopeSessions)
    .where(eq(schema.scopeSessions.gameId, id))
    .get();
  const daemon =
    game.slug === null
      ? undefined
      : deps.db
          .select({ slug: schema.gameDaemons.slug })
          .from(schema.gameDaemons)
          .where(eq(schema.gameDaemons.slug, game.slug))
          .get();
  return release || job || scope || daemon ? [] : [{ id, title: game.title, createdAt: game.createdAt }];
}

export async function pruneFailedCreate(deps: AppDeps, id: string): Promise<boolean> {
  if (isGameProvisioning(id)) return false;
  if (failedCreateCandidate(deps, id).length === 0 || isGameProvisioning(id)) return false;
  const auditIds = await commitAuditIds(deps);
  if (!auditIds.includes(id) || failedCreateCandidate(deps, id).length === 0 || isGameProvisioning(id)) return false;
  const removed = deps.db.delete(schema.games).where(eq(schema.games.id, id)).run();
  if (removed.changes === 0) return false;
  return true;
}

export function setup(deps: AppDeps): void {
  deps.registry.repoProvisioner ??= new CommitServiceRepoProvisioner({
    baseUrl: deps.config.commitInternalUrl,
    token: deps.config.commitServiceToken,
    instanceRepo: deps.config.instanceRepo,
    templateRef: deps.config.gameTemplateRef,
  });
  deps.registry.gameResolver = async (id) => {
    const game = deps.db
      .select({ familyId: schema.games.familyId, ownerId: schema.games.ownerId, visibility: schema.games.visibility })
      .from(schema.games)
      .where(eq(schema.games.id, id))
      .get();
    return game ?? null;
  };
}

const createBody = z
  .object({
    title: z.string().trim().min(1).max(120),
    repoVisibility: z.enum(['public', 'private']),
    allowAiGeneratedAssets: z.boolean().default(true),
  })
  .strict();
const patchBody = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    preserveSlug: z.boolean().optional(),
    visibility: z.enum(['listed', 'private']).optional(),
    allowAiGeneratedAssets: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => body.title !== undefined || body.visibility !== undefined || body.allowAiGeneratedAssets !== undefined,
    { message: 'no changes' },
  );

const routes = new Hono<ApiBindings>()
  .post('/games', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    requireAuthorization(authorize(actorFromPrincipal(principal), 'game.create', { familyId: principal.familyId }));
    const body = await parseBody(c, createBody);
    if (!c.get('deps').registry.repoProvisioner) throw new HttpError(503, 'repo_provisioner_unavailable');
    // Creators never connect GitHub: the operator installed the App on the instance repository once.
    const deps = c.get('deps');
    const qa = readQaState(deps.db);
    const isQaCreator = qa?.userId === principal.userId && qa.familyId === principal.familyId;
    const repository = isQaCreator ? deps.config.qaInstanceRepo : undefined;
    if (
      isQaCreator &&
      (!repository ||
        `${repository.owner}/${repository.name}`.toLowerCase() ===
          `${deps.config.instanceRepo.owner}/${deps.config.instanceRepo.name}`.toLowerCase())
    )
      throw new HttpError(503, 'qa_repository_not_configured');
    const result = deps.sqlite
      .transaction(() => {
        const zone = getBudgetSettings(deps.db, principal.familyId, budgetDefaults(deps)).resetZone;
        const daily = newGameDailyUsage(deps.db, principal.userId, new Date(), zone);
        if (
          principal.platformRole === 'none' &&
          deps.config.testerNewGamesPerDay !== undefined &&
          daily.count >= deps.config.testerNewGamesPerDay
        )
          return { refusal: daily.resetsAt } as const;
        return {
          game: createGameRow(deps.db, {
            familyId: principal.familyId,
            ownerId: principal.userId,
            title: body.title,
            repoVisibility: body.repoVisibility,
            allowAiGeneratedAssets: body.allowAiGeneratedAssets,
            repository,
          }),
        } as const;
      })
      .immediate();
    if ('refusal' in result)
      return c.json(
        {
          error: 'energy_limit_reached',
          remainingMicroUsd: 0,
          resetsAt: result.refusal,
          offers: ['ask_admin'],
          window: 'day',
        },
        402,
      );
    const game = result.game;
    try {
      return c.json(gameResponse(await provisionGame(deps, game)), 201);
    } catch (error) {
      // A transport failure can hide a successful remote commit, so keep that row for recovery.
      if (!(error instanceof GameProvisioningOutcomeUnknown))
        deps.db.delete(schema.games).where(eq(schema.games.id, game.id)).run();
      throw error;
    }
  })
  .get('/games', async (c) => {
    c.header('Cache-Control', 'no-store');
    const principal = requirePrincipal(c, ['user']);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.play', {
        familyId: principal.familyId,
        visibility: 'listed',
      }),
    );
    const db = c.get('deps').db;
    const games = listGames(db, principal.familyId, principal.userId);
    const plays = db.select().from(schema.gamePlays).where(eq(schema.gamePlays.userId, principal.userId)).all();
    const playedAt = new Map(plays.map((play) => [play.gameId, play.lastPlayedAt]));
    const media = await gameMedia(
      c.get('deps'),
      games.map((game) => game.id),
      { principal, headers: c.req.raw.headers },
    );
    const stats = gameStats(db, games);
    // A game with a published release is live: the menu's status shows it beside the game (#854).
    const live = new Set(
      games.length === 0
        ? []
        : db
            .selectDistinct({ gameId: schema.releases.gameId })
            .from(schema.releases)
            .where(
              inArray(
                schema.releases.gameId,
                games.map((game) => game.id),
              ),
            )
            .all()
            .map((row) => row.gameId),
    );
    return c.json({
      games: games.map((game) => ({
        ...gameResponse(game),
        ...media.get(game.id),
        stats: stats.get(game.id),
        lastPlayedAt: playedAt.get(game.id) ?? null,
        live: live.has(game.id),
      })),
    });
  })
  .get('/games/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const principal = requirePrincipal(c, ['user']);
    const game = findGameForFamily(c.get('deps').db, c.req.param('id'), principal.familyId);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.play', {
        familyId: game.familyId,
        ownerId: game.ownerId,
        visibility: game.visibility,
        granted: hasGameGrant(c.get('deps').db, game.id, principal.userId),
      }),
    );
    const media = await gameMedia(c.get('deps'), [game.id], { principal, headers: c.req.raw.headers });
    const stats = gameStats(c.get('deps').db, [game]);
    return c.json({ ...gameResponse(game), ...media.get(game.id), stats: stats.get(game.id) });
  })
  // Every shareable `/play/<ref>` link lands here: the current slug, a slug the game has outgrown, or its id.
  .get('/games/resolve/:ref', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const game = findGameBySlugOrId(c.get('deps').db, c.req.param('ref'));
    if (!game) throw new HttpError(404, 'game_not_found');
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.play', {
        familyId: game.familyId,
        ownerId: game.ownerId,
        visibility: game.visibility,
        granted: hasGameGrant(c.get('deps').db, game.id, principal.userId),
      }),
    );
    return c.json({ game: gameResponse(game) });
  })
  .post('/games/:id/play', (c) => {
    const principal = requirePrincipal(c, ['user']);
    const db = c.get('deps').db;
    const game = findGame(db, c.req.param('id'));
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.play', {
        familyId: game.familyId,
        ownerId: game.ownerId,
        visibility: game.visibility,
        granted: hasGameGrant(db, game.id, principal.userId),
      }),
    );
    const lastPlayedAt = new Date().toISOString();
    const suppliedId = c.req.header('x-ogm-play-id');
    if (suppliedId && !z.uuid().safeParse(suppliedId).success) throw new HttpError(400, 'invalid_play_id');
    db.transaction((tx) => {
      tx.insert(schema.gamePlays)
        .values({ gameId: game.id, userId: principal.userId, lastPlayedAt })
        .onConflictDoUpdate({ target: [schema.gamePlays.gameId, schema.gamePlays.userId], set: { lastPlayedAt } })
        .run();
      const sessions = schema.gamePlaySessions;
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      tx.delete(sessions).where(lt(sessions.createdAt, cutoff)).run();
      const recent =
        tx
          .select({ value: count() })
          .from(sessions)
          .where(and(eq(sessions.gameId, game.id), eq(sessions.userId, principal.userId)))
          .get()?.value ?? 0;
      if (recent < 100) {
        const inserted = tx
          .insert(sessions)
          .values({
            gameId: game.id,
            id: suppliedId ?? randomUUID(),
            userId: principal.userId,
            createdAt: lastPlayedAt,
          })
          .onConflictDoNothing()
          .run();
        if (inserted.changes) {
          tx.insert(schema.gamePlayTotals)
            .values({ gameId: game.id, plays: 1 })
            .onConflictDoUpdate({
              target: schema.gamePlayTotals.gameId,
              set: { plays: sql`${schema.gamePlayTotals.plays} + 1` },
            })
            .run();
        }
      }
    });
    return c.json({ lastPlayedAt });
  })
  .patch('/games/:id', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const game = findGameForFamily(c.get('deps').db, c.req.param('id'), principal.familyId);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
    );
    const body = await parseBody(c, patchBody);
    const db = c.get('deps').db;
    const { preserveSlug, ...changes } = body;
    const title = changes.title;
    const slug =
      title !== undefined && title !== game.title && !preserveSlug
        ? assignSlug(db, title, { gameId: game.id, slug: game.slug })
        : game.slug;
    db.transaction((tx) => {
      tx.update(schema.games)
        .set({ ...changes, slug })
        .where(eq(schema.games.id, game.id))
        .run();
      if (changes.visibility !== undefined && changes.visibility !== game.visibility)
        invalidateArtifactGrants(tx, 'game', game.id);
    });
    return c.json(gameResponse(findGame(db, game.id)));
  })
  .post('/games/:id/provision', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const game = findGameForFamily(c.get('deps').db, c.req.param('id'), principal.familyId);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
    );
    return c.json(gameResponse(await provisionGame(c.get('deps'), game)));
  })
  .get('/internal/admin/games/prune-failed-candidates', async (c) => {
    requireCommitService(c);
    return c.json({ games: await failedCreateCandidates(c.get('deps')) });
  })
  .delete('/internal/admin/games/:id/prune-failed', async (c) => {
    requireCommitService(c);
    return c.json({ removed: await pruneFailedCreate(c.get('deps'), c.req.param('id')) });
  });

function requireCommitService(c: Parameters<typeof requirePrincipal>[0]): void {
  const deps = c.get('deps');
  if (
    !sameSecret(c.req.header('x-ogm-internal') ?? '', deps.config.internalToken) ||
    c.req.header('x-ogm-service') !== 'commit'
  )
    throw new HttpError(403, 'forbidden');
}

export default routes;
