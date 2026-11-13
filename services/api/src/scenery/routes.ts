import { extname } from 'node:path';
import { and, desc, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';

import { fallbackEditorPalette, loadIndex, packOf, type ResolvedCard } from '@ogm/asset-cards';
import { loadEnv } from '@ogm/config';
import { AgreedScope, type AssetsLock } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { authorize } from '@ogm/policy';

import { actorFromPrincipal, requireAuthorization } from '../accounts/families.js';
import { HttpError } from '../app/errors.js';
import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';
import { thumbnailUrl } from '../catalog/routes.js';
import { mediaSigner } from '../build-chat/media.js';
import { getChatRow, listCommands } from '../build-chat/store.js';
import { findGameForFamily } from '../games/games.js';
import { authorizedGame } from '../games/authorize.js';
import { readGameLock, readSceneryFile, readScenerySource } from './source.js';
import { scopePaletteItems } from './scope-palette.js';
import { selectStageMedia } from './stage.js';
import { latestSceneryEdit } from './edit-time.js';

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
  async function source(c: Parameters<typeof requirePrincipal>[0], includeUpdatedAt = true, branchName?: string) {
    const target = checkout(c);
    const selected = branchName ?? c.req.query('branch') ?? 'main';
    const branch =
      selected === 'main'
        ? undefined
        : c
            .get('deps')
            .db.select()
            .from(schema.branches)
            .where(
              and(
                eq(schema.branches.gameId, target.game.id),
                or(eq(schema.branches.id, selected), eq(schema.branches.name, selected)),
              ),
            )
            .get();
    if (selected !== 'main' && !branch) throw new HttpError(404, 'scenery_source_unavailable');
    try {
      return await readScenerySource(
        target.checkout,
        target.path,
        includeUpdatedAt,
        branch?.name === 'main' ? undefined : branch?.gitRef,
      );
    } catch {
      throw new HttpError(404, 'scenery_source_unavailable');
    }
  }
  return new Hono<ApiBindings>()
    .get('/games/:gameId/editor/stage', async (c) => {
      const game = authorizedGame(c, 'game.edit');
      const deps = c.get('deps');
      const branch = c.req.query('branch') ?? 'main';
      if (!branch || branch.length > 200) throw new HttpError(400, 'invalid_request');
      const jobs = deps.db
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(and(eq(schema.jobs.gameId, game.id), eq(schema.jobs.branchId, branch)))
        .all();
      const commands = jobs.flatMap(({ id }) => listCommands(deps.sqlite, id));
      const reviews = deps.db
        .select({
          jobId: schema.commandReviews.jobId,
          commandId: schema.commandReviews.commandId,
          at: schema.commandReviews.at,
        })
        .from(schema.commandReviews)
        .where(eq(schema.commandReviews.gameId, game.id))
        .orderBy(desc(schema.commandReviews.at))
        .all();
      const reviewTimes = new Map<string, string>();
      for (const review of reviews) {
        if (!review.jobId) continue;
        const key = `${review.jobId}\0${review.commandId}`;
        if (!reviewTimes.has(key)) reviewTimes.set(key, review.at);
      }
      const row = selectStageMedia(
        commands,
        (id) => getChatRow(deps.sqlite, id),
        game.allowAiGeneratedAssets,
        reviewTimes,
      );
      c.header('Cache-Control', 'private, no-store');
      if (!row || !row.mediaHash) return c.json({ stage: null });
      const sign = mediaSigner(deps.blobStore);
      return c.json({
        stage: {
          kind: row.kind,
          at: row.at,
          url: await sign(row.mediaHash),
          ...(row.posterHash ? { poster: await sign(row.posterHash) } : {}),
        },
      });
    })
    .get('/games/:gameId/editor/fallback', async (c) => {
      const game = authorizedGame(c, 'game.edit');
      const deps = c.get('deps');
      const daemon = game.slug
        ? deps.db.select().from(schema.gameDaemons).where(eq(schema.gameDaemons.slug, game.slug)).get()
        : undefined;
      let assets: AssetsLock['assets'] = [];
      if (daemon && game.githubPath) {
        try {
          assets = (await readGameLock(daemon.checkoutPath, game.githubPath)).lock.assets;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new HttpError(404, 'editor_assets_unavailable');
        }
      }
      let cards: ResolvedCard[] = [];
      const thumbnails = new Map<string, string>();
      if (assetsRoot && assets.length > 0) {
        const index = await loadIndex(assetsRoot);
        cards = index.cards;
        const packs = new Set(assets.map((asset) => packOf(asset.id)).filter((pack) => pack !== undefined));
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
      const ids = assets
        .filter(
          (entry) =>
            game.allowAiGeneratedAssets ||
            (entry.meta?.generation?.method !== 'ai' && byId.get(entry.id)?.generation?.method !== 'ai'),
        )
        .map((entry) => entry.id);
      const palette = fallbackEditorPalette(ids, cards, (card) => thumbnails.get(packOf(card.id) ?? ''));
      const locked = new Map(assets.map((asset) => [asset.id, asset]));
      palette.palette.items = palette.palette.items.map((item) => {
        const thumbnail = item.thumbnail ?? thumbnails.get(packOf(item.prefab) ?? '');
        const generated = item.aiGenerated || locked.get(item.prefab)?.meta?.generation?.method === 'ai';
        return { ...item, ...(thumbnail ? { thumbnail } : {}), ...(generated ? { aiGenerated: true } : {}) };
      });
      const scopeRow = deps.db
        .select()
        .from(schema.scopeSessions)
        .where(and(eq(schema.scopeSessions.gameId, game.id), eq(schema.scopeSessions.status, 'agreed')))
        .orderBy(desc(schema.scopeSessions.createdAt))
        .get();
      if (scopeRow?.scope) {
        let data: unknown;
        try {
          data = JSON.parse(scopeRow.scope);
        } catch {
          data = undefined;
        }
        const scope = AgreedScope.safeParse(data);
        if (scope.success) {
          const items = scopePaletteItems(scope.data);
          const labels = { characters: 'Characters', scenery: 'Scenery', props: 'Props', audio: 'Audio' } as const;
          for (const item of items) {
            const category = item.category as keyof typeof labels;
            if (!palette.palette.categories.some((entry) => entry.id === category))
              palette.palette.categories.push({ id: category, label: labels[category], kind: 'items' });
            palette.palette.items.push(item);
          }
        }
      }
      c.header('Cache-Control', 'private, no-store');
      return c.json(palette);
    })
    .get('/games/:gameId/scenery/source', async (c) => {
      const bundle = await source(c);
      const deps = c.get('deps');
      const gameId = c.req.param('gameId');
      const selected = c.req.query('branch') ?? 'main';
      const branch = deps.db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(
          and(
            eq(schema.branches.gameId, gameId),
            or(eq(schema.branches.name, selected), eq(schema.branches.id, selected)),
          ),
        )
        .get();
      const lastEdit =
        branch &&
        latestSceneryEdit(
          deps.db
            .select({
              at: schema.designTransactions.createdAt,
              patches: schema.designTransactions.patchesJson,
              inverse: schema.designTransactions.inverseJson,
            })
            .from(schema.designTransactions)
            .where(and(eq(schema.designTransactions.gameId, gameId), eq(schema.designTransactions.branchId, branch.id)))
            .orderBy(desc(schema.designTransactions.rev))
            .all(),
        );
      const mainFileTime = selected === 'main' ? bundle.updatedAt : undefined;
      const updatedAt =
        lastEdit && (!mainFileTime || Date.parse(lastEdit) > Date.parse(mainFileTime)) ? lastEdit : mainFileTime;
      const assets = bundle.lock.assets.map((entry, index) => ({
        id: entry.id,
        path: entry.path,
        sha256: entry.sha256,
        url: `${prefix}/games/${encodeURIComponent(c.req.param('gameId'))}/scenery/assets/${index}${selected === 'main' ? '' : `~${Buffer.from(selected).toString('base64url')}`}/${entry.sha256}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
      }));
      c.header('Cache-Control', 'private, no-store');
      return c.json({ scene: bundle.scene, assets, ...(updatedAt ? { updatedAt } : {}) });
    })
    .get('/games/:gameId/scenery/assets/:index/:hash/*', async (c) => {
      const index = c.req.param('index');
      const match = /^(\d+)(?:~([A-Za-z0-9_-]+))?$/u.exec(index);
      if (!match) throw new HttpError(404, 'scenery_asset_unavailable');
      const bundle = await source(c, false, match[2] ? Buffer.from(match[2], 'base64url').toString('utf8') : 'main');
      const entry = bundle.lock.assets[Number(match[1])];
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
          commit: bundle.commit,
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
