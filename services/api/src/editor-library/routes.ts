import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

import { Hono, type Context } from 'hono';
import sharp from 'sharp';

import { editorLibrary, loadIndex, packOf } from '@ogm/asset-cards';
import { loadEnv } from '@ogm/config';
import type { EditorLibrary } from '@ogm/contracts';

import { HttpError } from '../app/errors.js';
import type { ApiBindings } from '../app/types.js';
import { authorizedGame } from '../games/authorize.js';
import { daemonRowForGame } from '../jobs/daemons.js';
import { contained, readGameLock } from '../scenery/source.js';

export const prefix = '/api/v1';

const CACHE_MS = 5 * 60_000;
const MAX_THUMB_BYTES = 1024 * 1024;
const THUMB_SOURCES = new Set(['.png', '.webp']);
/** Thumbnails are cut to the piece and fit in this square; the sheet scales them up pixelated. */
const THUMB_PX = 192;
const THUMB_CACHE = 4000;
/** Pieces are at most a few hundred pixels a side; anything far bigger is not a thumbnail. */
const MAX_THUMB_PIXELS = 4096 * 4096;

type Built = { library: EditorLibrary; thumbs: Map<string, string> };

/**
 * The map maker's asset library (#1210): the game's style set and the packs it uses, read from the card catalog.
 * Thumbnails are licensed pack art, so they go only to someone who may edit the game, by card id, never by path.
 */
export function editorLibraryRoutes(assetsRoot?: string): Hono<ApiBindings> {
  const cache = new Map<string, { at: number; entry: Promise<Built> }>();
  const pictures = new Map<string, Promise<Buffer>>();

  async function libraryFor(c: Context<ApiBindings>): Promise<Built> {
    const game = authorizedGame(c, 'game.edit');
    /* A game in a shared repository (Dusk Helm in open-games) has no daemon of its own slug. */
    const daemon = daemonRowForGame(c.get('deps').db, game.id);
    if (!assetsRoot || !daemon || !game.githubPath) throw new HttpError(404, 'editor_library_unavailable');
    /* One build per game per cache period: every thumbnail request reads it, so it must not reread the locks. */
    const key = `${game.id}:${game.allowAiGeneratedAssets}`;
    const now = Date.now();
    const current = cache.get(key);
    if (current && now - current.at <= CACHE_MS) return current.entry;
    for (const [old, entry] of cache) if (now - entry.at > CACHE_MS) cache.delete(old);
    const checkout = daemon.checkoutPath;
    const gamePath = game.githubPath;
    const next = {
      at: now,
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
      if (!path || !THUMB_SOURCES.has(extname(path).toLowerCase()) || !assetsRoot)
        throw new HttpError(404, 'not_found');
      let picture = pictures.get(path);
      if (!picture) {
        picture = readThumb(assetsRoot, path);
        pictures.set(path, picture);
        picture.catch(() => pictures.delete(path));
        if (pictures.size > THUMB_CACHE) pictures.delete(pictures.keys().next().value!);
      }
      let bytes: Buffer;
      try {
        bytes = await picture;
      } catch {
        throw new HttpError(404, 'not_found');
      }
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
    });
}

/**
 * A pack piece sits in a corner of a large transparent canvas (an iso wall fills a strip of a 128x256 tile), so the
 * thumbnail is cut to its opaque pixels and fit in a small square, kept pixel-sharp.
 */
async function readThumb(assetsRoot: string, path: string): Promise<Buffer> {
  const file = await contained(assetsRoot, path);
  if ((await stat(file)).size > MAX_THUMB_BYTES) throw new Error('thumbnail too large');
  const bytes = await readFile(file);
  const fit = (image: ReturnType<typeof sharp>) =>
    image
      .resize(THUMB_PX, THUMB_PX, { fit: 'inside', kernel: 'nearest', withoutEnlargement: true })
      .webp({ lossless: true })
      .toBuffer();
  try {
    return await fit(sharp(bytes, { limitInputPixels: MAX_THUMB_PIXELS }).trim({ threshold: 1 }));
  } catch {
    /* A fully transparent picture has nothing to trim: send it fitted. An unreadable one fails, and the route 404s. */
    return fit(sharp(bytes, { limitInputPixels: MAX_THUMB_PIXELS }));
  }
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
