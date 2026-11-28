import {
  CATALOG_KINDS,
  loadCatalog,
  searchCatalog,
  type CatalogIndex,
  type CatalogKind,
  type CatalogQuery,
} from '@ogm/asset-cards';
import { Hono } from 'hono';

import { requirePrincipal } from '../app/principal.js';
import type { ApiBindings } from '../app/types.js';

/** Keep a hot projection for search, periodically refreshing it from the authoritative inputs. */
export function catalogAssetRoutes(root: string | undefined): Hono<ApiBindings> {
  let current: CatalogIndex | undefined;
  let refreshed = 0;
  let loading: Promise<CatalogIndex> | undefined;
  const index = async (): Promise<CatalogIndex | undefined> => {
    if (!root) return undefined;
    if (!loading && (!current || Date.now() - refreshed > 5000)) {
      loading = loadCatalog(root)
        .then((result) => {
          current = result;
          refreshed = Date.now();
          return result;
        })
        .finally(() => {
          loading = undefined;
        });
    }
    if (!current) return loading;
    if (loading) void loading.catch(() => undefined);
    return current;
  };
  return new Hono<ApiBindings>()
    .get('/assets', async (c) => {
      requirePrincipal(c, ['user']);
      const kind = c.req.query('kind');
      if (kind && !CATALOG_KINDS.includes(kind as CatalogKind)) return c.json({ error: 'invalid_kind' }, 400);
      const limitText = c.req.query('limit') ?? '50';
      const limit = Number(limitText);
      if (!/^\d+$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 100)
        return c.json({ error: 'invalid_limit' }, 400);
      const source = await index();
      if (!source) return c.json({ error: 'catalog_unavailable' }, 503);
      const query: CatalogQuery = {
        words: c.req.query('q'),
        kind: kind as CatalogKind | undefined,
        pack: c.req.query('pack'),
        style: c.req.query('style'),
        license: c.req.query('license'),
        use: c.req.query('use'),
      };
      const ai = c.req.query('aiGenerated');
      if (ai !== undefined && ai !== 'true' && ai !== 'false') return c.json({ error: 'invalid_ai_generated' }, 400);
      if (ai !== undefined) query.aiGenerated = ai === 'true';
      const hits = searchCatalog(source, query);
      const facets = Object.fromEntries(
        CATALOG_KINDS.map((value) => [value, hits.filter((hit) => hit.kind === value).length]),
      );
      const cursor = c.req.query('cursor');
      const start = cursor ? hits.findIndex((hit) => hit.id === cursor) + 1 : 0;
      if (cursor && start === 0) return c.json({ error: 'invalid_cursor' }, 400);
      const assets = hits.slice(start, start + limit);
      return c.json({ assets, facets, nextCursor: start + limit < hits.length ? assets.at(-1)?.id : null });
    })
    .get('/assets/:id', async (c) => {
      requirePrincipal(c, ['user']);
      const source = await index();
      if (!source) return c.json({ error: 'catalog_unavailable' }, 503);
      const asset = source.assets.find((item) => item.id === c.req.param('id'));
      return asset ? c.json(asset) : c.json({ error: 'not_found' }, 404);
    })
    .get('/packs/:id', async (c) => {
      requirePrincipal(c, ['user']);
      const source = await index();
      if (!source) return c.json({ error: 'catalog_unavailable' }, 503);
      const pack = source.packs.find((item) => item.id === c.req.param('id'));
      return pack ? c.json(pack) : c.json({ error: 'not_found' }, 404);
    });
}
