import { extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { fallbackEditorPalette, loadIndex, packOf, type ResolvedCard } from '@ogm/asset-cards';
import { loadEnv } from '@ogm/config';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { thumbnailUrl } from '../catalog/routes.js';
import { findGameForFamily } from '../games/games.js';
import { readGameLock, readSceneryFile, readScenerySource } from './source.js';

export const prefix = '/api/v1';

export function sceneryRoutes(assetsRoot?: string): Hono<ApiBindings> {
  function checkout(c: Parameters<typeof requirePrincipal>[0]) {
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
    return { game, path: game.githubPath, checkout: daemon.checkoutPath };
  }
  async function source(c: Parameters<typeof requirePrincipal>[0]) {
    const target = checkout(c);
    try {
      return await readScenerySource(target.checkout, target.path);
    } catch {
      throw new HttpError(404, 'scenery_source_unavailable');
    }
  }
  return new Hono<ApiBindings>()
    .get('/games/:gameId/editor/fallback', async (c) => {
      const target = checkout(c);
      let lock;
      try {
        ({ lock } = await readGameLock(target.checkout, target.path));
      } catch {
        throw new HttpError(404, 'editor_assets_unavailable');
      }
      let cards: ResolvedCard[] = [];
      const thumbnails = new Map<string, string>();
      if (assetsRoot) {
        const index = await loadIndex(assetsRoot);
        cards = index.cards;
        const packs = new Set(lock.assets.map((asset) => packOf(asset.id)).filter((pack) => pack !== undefined));
        await Promise.all(
          Object.values(index.collections).map(async (card) => {
            const pack = packOf(card.id);
            if (!pack || !packs.has(pack)) return;
            const url = await thumbnailUrl(c.get('deps').blobStore, card);
            if (url) thumbnails.set(pack, url);
          }),
        );
      }
      const byId = new Map(cards.map((card) => [card.id, card]));
      const ids = lock.assets
        .filter(
          (entry) =>
            target.game.allowAiGeneratedAssets ||
            (entry.meta?.generation?.method !== 'ai' && byId.get(entry.id)?.generation?.method !== 'ai'),
        )
        .map((entry) => entry.id);
      const palette = fallbackEditorPalette(ids, cards, (card) => thumbnails.get(packOf(card.id) ?? ''));
      const locked = new Map(lock.assets.map((asset) => [asset.id, asset]));
      palette.palette.items = palette.palette.items.map((item) => {
        const thumbnail = item.thumbnail ?? thumbnails.get(packOf(item.prefab) ?? '');
        const generated = item.aiGenerated || locked.get(item.prefab)?.meta?.generation?.method === 'ai';
        return { ...item, ...(thumbnail ? { thumbnail } : {}), ...(generated ? { aiGenerated: true } : {}) };
      });
      c.header('Cache-Control', 'private, no-store');
      return c.json(palette);
    })
    .get('/games/:gameId/scenery/source', async (c) => {
      const bundle = await source(c);
      const assets = bundle.lock.assets.map((entry, index) => ({
        id: entry.id,
        path: entry.path,
        sha256: entry.sha256,
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
