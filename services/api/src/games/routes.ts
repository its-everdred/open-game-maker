import { Hono } from 'hono';
import { z } from 'zod';

import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';
import { eq } from 'drizzle-orm';

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
  .get('/games', (c) => {
    const principal = requirePrincipal(c, ['user']);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.play', {
        familyId: principal.familyId,
        visibility: 'listed',
      }),
    );
    return c.json({ games: listGames(c.get('deps').db, principal.familyId, principal.userId).map(gameResponse) });
  })
  .get('/games/:id', (c) => {
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
    return c.json(gameResponse(game));
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
  .patch('/games/:id', async (c) => {
    const principal = requirePrincipal(c, ['user']);
    const game = findGameForFamily(c.get('deps').db, c.req.param('id'), principal.familyId);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
    );
    const body = await parseBody(c, patchBody);
    const db = c.get('deps').db;
    const title = body.title;
    const slug =
      title !== undefined && title !== game.title
        ? assignSlug(db, title, { gameId: game.id, slug: game.slug })
        : game.slug;
    db.update(schema.games)
      .set({ ...body, slug })
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
