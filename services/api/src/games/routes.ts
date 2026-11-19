import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';

import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { and, count, eq, inArray, lt, sql } from 'drizzle-orm';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { parseBody } from '../app/validate.js';
import {
  createGameRow,
  findGame,
  findGameForFamily,
  gameResponse,
  hasGameGrant,
  listGames,
  provisionGame,
} from './games.js';
import { gameMedia } from './media.js';
import { gameStats } from './stats.js';
import { assignSlug, findGameBySlugOrId } from './slug.js';
import { CommitServiceRepoProvisioner } from './repo-provisioner.js';

export const prefix = '/api/v1';

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
    const game = createGameRow(c.get('deps').db, {
      familyId: principal.familyId,
      ownerId: principal.userId,
      title: body.title,
      repoVisibility: body.repoVisibility,
      allowAiGeneratedAssets: body.allowAiGeneratedAssets,
    });
    return c.json(gameResponse(await provisionGame(c.get('deps'), game)), 201);
  })
  .get('/games', async (c) => {
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
    const media = await gameMedia(c.get('deps'), [game.id]);
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
    db.update(schema.games)
      .set({ ...changes, slug })
      .where(eq(schema.games.id, game.id))
      .run();
    return c.json(gameResponse(findGame(db, game.id)));
  })
  .post('/games/:id/provision', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const game = findGameForFamily(c.get('deps').db, c.req.param('id'), principal.familyId);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
    );
    return c.json(gameResponse(await provisionGame(c.get('deps'), game)));
  });

export default routes;
