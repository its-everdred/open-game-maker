import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { SceneDocSchema, SceneIdSchema, type AssetsLock } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { InvalidSceneError, SceneBaseUnavailableError } from '@ogm/design-log';

import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import type { GameRow } from '../games/games.js';
import { readGameLock, readSceneFiles } from '../scenery/source.js';
import { creatorAuthor, readScene, seedScene, writeScene, type SceneStore } from './store.js';

export const prefix = '/api/v1';

/** The game's main checkout, where scenes committed to the repository are read from on first open. */
function checkoutOf(c: { get(key: 'deps'): ApiBindings['Variables']['deps'] }, game: GameRow) {
  if (!game.slug || !game.githubPath) return undefined;
  const daemon = c.get('deps').db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug)).get();
  return daemon ? { checkout: daemon.checkoutPath, path: game.githubPath } : undefined;
}

/** The shared store for a scene, started from the repository's copy the first time anyone opens it. */
export async function sharedScene(
  c: { get(key: 'deps'): ApiBindings['Variables']['deps'] },
  game: GameRow,
  scene: string,
): Promise<SceneStore | undefined> {
  const db = c.get('deps').db;
  const stored = readScene(db, game.id, scene);
  if (stored) return stored;
  const target = checkoutOf(c, game);
  const files = target ? await readSceneFiles(target.checkout, target.path, scene).catch(() => undefined) : undefined;
  return files ? seedScene(db, game.id, files, new Date()) : undefined;
}

/** Facing images of the game's locked iso sprites, served by the scenery asset route; the map maker draws with them. */
export function spriteUrls(gameId: string, lock: AssetsLock): Record<string, { facings: Record<string, string> }> {
  const sprites: Record<string, { facings: Record<string, string> }> = {};
  lock.assets.forEach((entry, index) => {
    const sprite = entry.meta?.sprite;
    if (sprite?.drawn_view !== 'iso' || !sprite.facings) return;
    const facings: Record<string, string> = {};
    for (const [facing, path] of Object.entries(sprite.facings)) {
      if (typeof path !== 'string') continue;
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      facings[facing] =
        `${prefix}/games/${encodeURIComponent(gameId)}/scenery/assets/${index}/${entry.sha256}/${encoded}`;
    }
    if (Object.keys(facings).length > 0) sprites[entry.id] = { facings };
  });
  return sprites;
}

const SaveSchema = z.strictObject({
  baseRev: z.number().int().nonnegative(),
  doc: SceneDocSchema,
  label: z.string().max(200).optional(),
});

export default new Hono<ApiBindings>()
  .get('/games/:gameId/editor/scenes/:scene', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const scene = SceneIdSchema.safeParse(c.req.param('scene'));
    if (!scene.success) throw new HttpError(400, 'invalid_request');
    const store = await sharedScene(c, game, scene.data);
    if (!store) throw new HttpError(404, 'scene_not_found');
    const target = checkoutOf(c, game);
    let sprites: ReturnType<typeof spriteUrls> = {};
    if (target) {
      try {
        sprites = spriteUrls(c.req.param('gameId'), (await readGameLock(target.checkout, target.path)).lock);
      } catch {
        /* A game with no readable lock opens with no pictures; its tiles still show as outlines. */
      }
    }
    const last = store.log.at(-1);
    c.header('Cache-Control', 'private, no-store');
    return c.json({ rev: store.head.rev, doc: store.head.doc, author: last?.author ?? null, sprites });
  })
  .post('/games/:gameId/editor/scenes/:scene/revisions', async (c) => {
    const game = authorizedGame(c, 'game.edit');
    const principal = requirePrincipal(c, ['user']);
    const scene = SceneIdSchema.safeParse(c.req.param('scene'));
    const body = SaveSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!scene.success || !body.success) throw new HttpError(400, 'invalid_request');
    const { doc, baseRev, label } = body.data;
    const existing = await sharedScene(c, game, scene.data);
    if (!existing) throw new HttpError(404, 'scene_not_found');
    if (doc.scene !== scene.data || doc.game !== existing.head.doc.game) throw new HttpError(400, 'invalid_request');
    let result;
    try {
      result = writeScene(c.get('deps').db, game.id, {
        doc,
        baseRev,
        author: creatorAuthor(principal.displayName),
        source: 'editor',
        label: label ?? '',
        now: new Date(),
      });
    } catch (error) {
      if (error instanceof InvalidSceneError || error instanceof SceneBaseUnavailableError) {
        throw new HttpError(409, 'scene_conflict');
      }
      throw error;
    }
    /* A creator's write is never refused (#1207: Kevin's edit wins); a failed result here is a store bug. */
    if (!result.ok) throw new HttpError(409, 'scene_conflict');
    c.header('Cache-Control', 'private, no-store');
    return c.json({ rev: result.head.rev, doc: result.head.doc, saved: result.revision !== null });
  });
