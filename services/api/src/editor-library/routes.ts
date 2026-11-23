import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import { editorLibrary, loadIndex, packOf } from '@ogm/asset-cards';
import { loadEnv } from '@ogm/config';
import type { EditorLibrary } from '@ogm/contracts';
import { schema } from '@ogm/db';

import { HttpError } from '../app/errors.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { contained, readGameLock } from '../scenery/source.js';

export const prefix = '/api/v1';

const CACHE_MS = 5 * 60_000;
const MAX_THUMB_BYTES = 1024 * 1024;
const THUMB_MIME = new Map([
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

type Built = { library: EditorLibrary; thumbs: Map<string, string> };

/**
 * The map maker's asset library (#1210): the game's style set and the packs it uses, read from the card catalog.
 * Thumbnails are licensed pack art, so they go only to someone who may edit the game, by card id, never by path.
 */
export function editorLibraryRoutes(assetsRoot?: string): Hono<ApiBindings> {
  const cache = new Map<string, { at: number; entry: Promise<Built> }>();

  async function libraryFor(c: Context<ApiBindings>): Promise<Built> {
    const game = authorizedGame(c, 'game.edit');
    const daemon = game.slug
      ? c.get('deps').db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug)).get()
      : undefined;
    if (!assetsRoot || !daemon || !game.githubPath) throw new HttpError(404, 'editor_library_unavailable');
    /* One build per game per cache period: every thumbnail request reads it, so it must not reread the locks. */
    const key = game.id;
    const current = cache.get(key);
    if (current && Date.now() - current.at <= CACHE_MS) return current.entry;
    const checkout = daemon.checkoutPath;
    const gamePath = game.githubPath;
    const next = {
      at: Date.now(),
      entry: (async () => {
        let source: { set?: string; packs: string[] };
        try {
          const { root, lock } = await readGameLock(checkout, gamePath);
          const packs = lock.assets.map((asset) => packOf(asset.id)).filter((pack) => pack !== undefined);
          source = { set: await readSet(root), packs: [...new Set(packs)].sort() };
        } catch {
          throw new HttpError(404, 'editor_library_unavailable');
        }
        return editorLibrary(await loadIndex(assetsRoot), {
          ...source,
          allowAiGenerated: game.allowAiGeneratedAssets,
        });
      })(),
    };
    cache.set(key, next);
    next.entry.catch(() => {
      if (cache.get(key) === next) cache.delete(key);
    });
    return next.entry;
  }

  return new Hono<ApiBindings>()
    .get('/games/:gameId/editor/library', async (c) => {
      const { library } = await libraryFor(c);
      c.header('Cache-Control', 'private, max-age=300');
      return c.json(library);
    })
    .get('/games/:gameId/editor/library/thumb', async (c) => {
      const { thumbs } = await libraryFor(c);
      const path = thumbs.get(c.req.query('card') ?? '');
      const mime = path ? THUMB_MIME.get(extname(path).toLowerCase()) : undefined;
      if (!path || !mime || !assetsRoot) throw new HttpError(404, 'not_found');
      let bytes: Buffer;
      try {
        const file = await contained(assetsRoot, path);
        if ((await stat(file)).size > MAX_THUMB_BYTES) throw new Error('thumbnail too large');
        bytes = await readFile(file);
      } catch {
        throw new HttpError(404, 'not_found');
      }
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=86400',
      });
    });
}

/** `gm.lock.json` names the game's style set; a game without one offers only the packs it already uses. */
async function readSet(root: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(await contained(root, 'gm.lock.json'), 'utf8');
  } catch {
    return undefined;
  }
  const set = (JSON.parse(text) as { set?: unknown }).set;
  return typeof set === 'string' && set !== '' ? set : undefined;
}

const env = loadEnv('api', { OGM_ASSETS_ROOT: { kind: 'path', required: false } });
export default editorLibraryRoutes(env.OGM_ASSETS_ROOT);
