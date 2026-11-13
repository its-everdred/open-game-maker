import { extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { loadEnv } from '@ogm/config';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { findGameForFamily } from '../games/games.js';
import { readSceneryFile, readScenerySource } from './source.js';

export const prefix = '/api/v1';

export function sceneryRoutes(assetsRoot?: string): Hono<ApiBindings> {
  async function source(c: Parameters<typeof requirePrincipal>[0]) {
    const principal = requirePrincipal(c, ['user']);
    const deps = c.get('deps');
    const gameId = c.req.param('gameId');
    if (!gameId) throw new HttpError(400, 'invalid_request');
    const game = findGameForFamily(deps.db, gameId, principal.familyId);
    requireAuthorization(
      authorize(actorFromPrincipal(principal), 'game.edit', { familyId: game.familyId, ownerId: game.ownerId }),
    );
    const daemon = game.slug
      ? deps.db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug)).get()
      : undefined;
    if (!daemon || !game.githubPath) throw new HttpError(404, 'scenery_source_unavailable');
    try {
      return await readScenerySource(daemon.checkoutPath, game.githubPath);
    } catch {
      throw new HttpError(404, 'scenery_source_unavailable');
    }
  }
  return new Hono<ApiBindings>()
    .get('/games/:gameId/scenery/source', async (c) => {
      const bundle = await source(c);
      const assets = bundle.lock.assets.map((entry, index) => ({
        id: entry.id,
        path: entry.path,
        url: `${prefix}/games/${encodeURIComponent(c.req.param('gameId'))}/scenery/assets/${index}/${entry.sha256}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
      }));
      c.header('Cache-Control', 'private, no-store');
      return c.json({ scene: bundle.scene, assets });
    })
    .get('/games/:gameId/scenery/assets/:index/:hash/*', async (c) => {
      const bundle = await source(c);
      const index = c.req.param('index');
      if (!/^\d+$/.test(index)) throw new HttpError(404, 'scenery_asset_unavailable');
      const entry = bundle.lock.assets[Number(index)];
      const marker = `/scenery/assets/${index}/${c.req.param('hash')}/`;
      const pathname = new URL(c.req.url).pathname;
      const offset = pathname.indexOf(marker);
      let path: string | undefined;
      try {
        if (offset >= 0)
          path = pathname
            .slice(offset + marker.length)
            .split('/')
            .map(decodeURIComponent)
            .join('/');
      } catch {
        throw new HttpError(404, 'scenery_asset_unavailable');
      }
      if (!entry || entry.sha256 !== c.req.param('hash') || !path)
        throw new HttpError(404, 'scenery_asset_unavailable');
      try {
        const bytes = await readSceneryFile({
          root: bundle.root,
          lock: bundle.lock,
          assetId: entry.id,
          path,
          assetsRoot,
          blobStore: c.get('deps').blobStore,
        });
        const mime: Record<string, string> = {
          '.glb': 'model/gltf-binary',
          '.gltf': 'model/gltf+json',
          '.bin': 'application/octet-stream',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
        };
        c.header('Cache-Control', 'private, no-store');
        c.header('X-Content-Type-Options', 'nosniff');
        return c.body(new Uint8Array(bytes), 200, {
          'Content-Type': mime[extname(path).toLowerCase()] ?? 'application/octet-stream',
        });
      } catch {
        throw new HttpError(404, 'scenery_asset_unavailable');
      }
    });
}

const env = loadEnv('api', { OGM_ASSETS_ROOT: { kind: 'path', required: false } });
export default sceneryRoutes(env.OGM_ASSETS_ROOT);
