import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex, catalogMedia, writeIndex } from '@ogm/asset-cards';
import { afterEach, expect, it } from 'vitest';

import { createApp } from '../src/app/app.js';
import { catalogRoutes, prefix } from '../src/catalog/routes.js';
import { catalogMediaFile } from '../src/catalog/media.js';
import { asUser, installUsers, makeDeps } from './helpers.js';

const fixture = fileURLToPath(new URL('../../../packages/asset-cards/test/fixtures/library', import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('serves only indexed media to signed-in users with byte ranges', async () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-media-'));
  roots.push(root);
  cpSync(fixture, root, { recursive: true });
  writeFileSync(
    join(root, 'catalog.json'),
    JSON.stringify({ packs: [{ id: 'kenney-mini-dungeon', vendor: 'Kenney', title: 'Mini Dungeon' }] }),
  );
  const index = await buildIndex(root);
  const card = index.cards.find((item) => item.id === 't1:kenney-mini-dungeon/character-orc@2.0')!;
  const path = join(root, card.previews!.thumb!);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from([1, 2, 3, 4]));
  await writeIndex(root, index);
  const deps = makeDeps();
  installUsers(deps, [
    {
      kind: 'user',
      userId: 'u_media',
      email: 'media@example.test',
      displayName: 'Media',
      familyId: null,
      platformRole: 'none',
      capability: 'creator',
    },
  ]);
  const app = createApp(deps);
  app.route(prefix, catalogRoutes({ assetsRoot: root }));
  const url = catalogMedia(card).thumb!;
  expect((await app.request(url)).status).toBe(401);
  expect((await app.request('/api/catalog/assets')).status).toBe(401);
  const listing = await app.request('/api/catalog/assets?q=orc&kind=model', { headers: asUser('u_media') });
  expect(listing.status).toBe(200);
  const body = (await listing.json()) as { assets: { id: string; previews: { thumb: string } }[] };
  expect(body.assets.some((asset) => asset.id === card.id && asset.previews.thumb === url)).toBe(true);
  const detail = await app.request(`/api/catalog/assets/${encodeURIComponent(card.id)}`, {
    headers: asUser('u_media'),
  });
  expect(detail.status).toBe(200);
  const response = await app.request(url, { headers: { ...asUser('u_media'), range: 'bytes=1-2' } });
  expect(response.status).toBe(206);
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3]);
  expect((await app.request(url.replace('/thumb', '/unknown'), { headers: asUser('u_media') })).status).toBe(404);
  expect(await catalogMediaFile(root, { ...card, previews: { thumb: '../outside.png' } }, 'thumb')).toBeUndefined();
  expect(
    await catalogMediaFile(
      root,
      { ...card, resolved: { ...card.resolved, rights: { ...card.resolved.rights, uses: [] } } },
      'thumb',
    ),
  ).toBeUndefined();
});

it('serves a recovered card only when its original rights are valid', async () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-recovered-'));
  roots.push(root);
  cpSync(fixture, root, { recursive: true });
  const pack = join(root, 'packs', 'kenney-mini-dungeon');
  const parentPath = join(pack, 'collection.card.json');
  const cardPath = join(pack, 'cards', 'character-orc.card.json');
  const parent = JSON.parse(readFileSync(parentPath, 'utf8'));
  const card = JSON.parse(readFileSync(cardPath, 'utf8'));
  parent.legacy_metadata = true;
  card.legacy_metadata = true;
  writeFileSync(parentPath, JSON.stringify(parent));
  writeFileSync(cardPath, JSON.stringify(card));
  writeFileSync(join(root, 'catalog.json'), JSON.stringify({ packs: [{ id: 'kenney-mini-dungeon' }] }));
  const source = join(pack, '2.0', 'extracted', 'vendor-wrapper', card.source.files[0].path);
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, Buffer.from([3, 4, 5]));
  const deps = makeDeps();
  installUsers(deps, [
    {
      kind: 'user',
      userId: 'u_media',
      email: 'media@example.test',
      displayName: 'Media',
      familyId: null,
      platformRole: 'none',
      capability: 'creator',
    },
  ]);
  const app = createApp(deps);
  app.route(prefix, catalogRoutes({ assetsRoot: root }));
  const url = `/api/catalog/assets/${encodeURIComponent(card.id)}/media/source`;
  const response = await app.request(url, { headers: { ...asUser('u_media'), range: 'bytes=1-2' } });
  expect(response.status).toBe(206);
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 5]);
  const duplicate = join(pack, '2.0', 'extracted', 'other-wrapper', card.source.files[0].path);
  mkdirSync(dirname(duplicate), { recursive: true });
  writeFileSync(duplicate, Buffer.from([9]));
  expect((await app.request(url, { headers: asUser('u_media') })).status).toBe(404);
});
