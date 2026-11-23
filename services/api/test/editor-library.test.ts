import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { schema } from '@ogm/db';

import { createApp } from '../src/app/app.js';
import { editorLibraryRoutes, prefix } from '../src/editor-library/routes.js';
import { asUser, installUsers, makeDeps, type TestUser } from './helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ids = {
  family: 'f_01K8Z6Y7X8P9Q0R1S2T3V4W5X6',
  creator: 'u_01K8Z6Y7X8P9Q0R1S2T3V4W5X7',
  other: 'u_01K8Z6Y7X8P9Q0R1S2T3V4W5X8',
  game: 'g_01K8Z6Y7X8P9Q0R1S2T3V4W5X9',
};
const THUMB = new Uint8Array([82, 73, 70, 70]);

function card(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    schema: 'ogm.asset-card/1.0',
    vocab: '2026-10-27',
    id,
    card_type: 'asset',
    status: 'measured',
    title,
    kind: 'sprite',
    subkind: 'tile',
    collection: id.replace(/\/.*@/, '@'),
    describe: {},
    provenance: {},
    resolved: {
      license: 'LicenseRef-test',
      rights: { uses: ['in-game'], audience: 'private', redistribution: 'in-build' },
      provenance: {},
      set: 'iso-set',
    },
    ...extra,
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ogm-editor-library-'));
  roots.push(root);
  const checkout = join(root, 'checkout');
  const game = join(checkout, 'games', 'fixture');
  mkdirSync(game, { recursive: true });
  writeFileSync(join(game, 'gm.lock.json'), JSON.stringify({ v: 1, set: 'iso-set' }));
  writeFileSync(
    join(game, 'assets.lock.json'),
    JSON.stringify({ version: 1, family: 'pixel-art', pov: 'iso', assets: [] }),
  );
  const assets = join(root, 'assets');
  mkdirSync(join(assets, 'index'), { recursive: true });
  mkdirSync(join(assets, 'private', 'previews'), { recursive: true });
  writeFileSync(join(assets, 'private', 'previews', 'fence.webp'), THUMB);
  writeFileSync(join(root, 'secret.webp'), new Uint8Array([1]));
  symlinkSync(join(root, 'secret.webp'), join(assets, 'private', 'previews', 'escape.webp'));
  writeFileSync(
    join(assets, 'index', 'cards.index.json'),
    JSON.stringify({
      version: 3,
      built: '2026-11-23T00:00:00Z',
      vocab: '2026-10-27',
      collections: {},
      errors: [],
      cards: [
        card('t1:rural/tiles/fence-a1@1', 'Fence A1', { previews: { thumb: 'private/previews/fence.webp' } }),
        card('t1:rural/tiles/escape@1', 'Wall Z1', { previews: { thumb: 'private/previews/escape.webp' } }),
        card('t1:other/tiles/tree@1', 'Tree A1', {
          previews: { thumb: 'private/previews/fence.webp' },
          resolved: {
            license: 'x',
            rights: { uses: ['in-game'], audience: 'private', redistribution: 'in-build' },
            provenance: {},
            set: 'other-set',
          },
        }),
      ],
    }),
  );
  return { checkout, assets };
}

function appWith(checkout: string, assets: string | undefined) {
  const user = (userId: string): TestUser => ({
    kind: 'user',
    userId,
    email: `${userId}@example.test`,
    familyId: ids.family,
    displayName: 'Creator',
    platformRole: 'none',
    capability: 'creator',
  });
  const deps = makeDeps();
  installUsers(deps, [user(ids.creator), user(ids.other)]);
  const now = '2026-11-01T00:00:00.000Z';
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.creator, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId: ids.family, userId: ids.creator, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId: ids.family, userId: ids.other, role: 'member', capability: 'creator', joinedAt: now },
    ])
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.creator,
      slug: 'fixture',
      githubPath: 'games/fixture',
      title: 'Fixture',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.gameDaemons)
    .values({
      slug: 'fixture',
      repo: 'example/repo',
      checkoutPath: checkout,
      unit: 'fixture.service',
      envFile: '/fixture.env',
      port: 34567,
      status: 'idle',
      createdAt: now,
    })
    .run();
  const app = createApp(deps);
  app.route(prefix, editorLibraryRoutes(assets));
  return app;
}

const libraryUrl = `/api/v1/games/${ids.game}/editor/library`;
const thumbUrl = (card: string) => `${libraryUrl}/thumb?card=${encodeURIComponent(card)}`;

describe('map maker asset library', () => {
  it("lists the game's style set for its editors only, without library paths", async () => {
    const { checkout, assets } = fixture();
    const app = appWith(checkout, assets);

    expect((await app.request(libraryUrl)).status).toBe(401);
    expect((await app.request(libraryUrl, { headers: asUser(ids.other) })).status).toBe(403);
    const response = await app.request(libraryUrl, { headers: asUser(ids.creator) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    const body = await response.json();
    expect(body).toMatchObject({
      set: 'iso-set',
      groups: [
        { id: 'fences', label: 'Fences' },
        { id: 'walls', label: 'Walls' },
      ],
      items: [
        { id: 't1:rural/tiles/fence-a1@1', group: 'fences', tag: 'Fence', pack: 'rural' },
        { id: 't1:rural/tiles/escape@1', group: 'walls' },
      ],
    });
    expect(body.items).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('previews');
  });

  it('serves a thumbnail only by a card id in the library, and never a file outside the asset root', async () => {
    const { checkout, assets } = fixture();
    const app = appWith(checkout, assets);
    const headers = asUser(ids.creator);

    expect((await app.request(thumbUrl('t1:rural/tiles/fence-a1@1'), { headers: asUser(ids.other) })).status).toBe(403);
    const thumb = await app.request(thumbUrl('t1:rural/tiles/fence-a1@1'), { headers });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    expect(thumb.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(THUMB);

    /* Not in this game's library (another set), a symlink out of the asset root, and a raw path all 404. */
    expect((await app.request(thumbUrl('t1:other/tiles/tree@1'), { headers })).status).toBe(404);
    expect((await app.request(thumbUrl('t1:rural/tiles/escape@1'), { headers })).status).toBe(404);
    expect((await app.request(thumbUrl('private/previews/fence.webp'), { headers })).status).toBe(404);
  });

  it('reports the library unavailable when the host has no asset library', async () => {
    const { checkout } = fixture();
    const app = appWith(checkout, undefined);

    expect((await app.request(libraryUrl, { headers: asUser(ids.creator) })).status).toBe(404);
  });
});
