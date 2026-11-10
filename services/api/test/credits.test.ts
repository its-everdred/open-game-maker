import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex, writeIndex } from '@ogm/asset-cards';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { ensureMainBranch } from '../src/design/store.js';
import { createApp } from '../src/app/app.js';
import { creditsRoutes } from '../src/credits/routes.js';
import { asUser, installUsers, makeApp, makeDeps } from './helpers.js';

const now = '2026-11-02T20:00:00.000Z';
const owner = 'u_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const family = 'f_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function pack(id: string, privatePack = false) {
  return {
    pack: id,
    title: id === 'synty' ? 'Synty Pack' : 'Open Pack',
    license: id === 'synty' ? 'LicenseRef-synty-personal' : 'CC0-1.0',
    licenseSource: 'License.txt',
    attribution: 'none required',
    source: { label: 'Vendor', url: `https://example.test/${id}` },
    private: privatePack,
  };
}

function addGame(
  deps: ReturnType<typeof makeDeps>,
  gameId: string,
  buildId: string,
  packs: unknown[],
  familyId = family,
) {
  deps.db
    .insert(schema.games)
    .values({
      id: gameId,
      familyId,
      ownerId: owner,
      title: gameId,
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  const branch = ensureMainBranch(deps.sqlite, gameId, { now: new Date(now) });
  const artifactPath = join(deps.config.gamesRoot, gameId, buildId);
  mkdirSync(artifactPath, { recursive: true });
  writeFileSync(join(artifactPath, 'credits.json'), JSON.stringify({ version: 1, packs }));
  deps.db
    .insert(schema.builds)
    .values({
      id: buildId,
      gameId,
      branchId: branch.id,
      gitSha: 'a'.repeat(40),
      sdkVersion: '1.0.0',
      saveSchemaVersion: 1,
      achievementCatalogHash: 'b'.repeat(64),
      status: 'tested',
      artifact: 'present',
      artifactPath,
      createdAt: now,
    })
    .run();
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, branch.id)).run();
}

async function setup() {
  const deps = makeDeps();
  deps.db.insert(schema.families).values({ id: family, name: 'Family', ownerUserId: owner, createdAt: now }).run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: family, userId: owner, role: 'owner', capability: 'creator', joinedAt: now })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: owner,
      displayName: 'Owner',
      familyId: family,
      platformRole: 'none',
      capability: 'creator',
      email: 'owner@example.test',
    },
  ]);
  return { ...(await makeApp(deps)), deps };
}

describe('GET /api/v1/credits', () => {
  it('badges an AI pack in credits from a legacy build using catalog provenance', async () => {
    const { deps } = await setup();
    const root = mkdtempSync(join(tmpdir(), 'ogm-credit-catalog-'));
    cpSync(fileURLToPath(new URL('../../../packages/asset-cards/test/fixtures/library', import.meta.url)), root, {
      recursive: true,
    });
    const index = await buildIndex(root);
    const card = Object.values(index.collections)[0]!;
    card.generation = { method: 'ai', tool: 'fixture generator' };
    await writeIndex(root, index);
    const packId = card.id.slice(3).split('@')[0]!;
    addGame(deps, 'g_one', 'build_one', [pack(packId), pack('authored')]);
    const app = createApp(deps);
    app.route('/api/v1', creditsRoutes(root));
    const response = await app.request('/api/v1/credits', { headers: asUser(owner) });
    const body = (await response.json()) as { packs: Array<{ pack: string; aiGenerated?: boolean }> };
    expect(body.packs.find((item) => item.pack === packId)?.aiGenerated).toBe(true);
    expect(body.packs.find((item) => item.pack === 'authored')?.aiGenerated).toBeUndefined();
  });
  it('deduplicates packs from every current family game and keeps private packs visible', async () => {
    const { app, deps } = await setup();
    addGame(deps, 'g_one', 'build_one', [pack('open')]);
    addGame(deps, 'g_two', 'build_two', [pack('open'), pack('synty', true)]);

    const response = await app.request('/api/v1/credits', { headers: asUser(owner) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, packs: [pack('open'), pack('synty', true)] });
  });

  it('returns the exact authorized game build for the pause HUD', async () => {
    const { app, deps } = await setup();
    addGame(deps, 'g_one', 'build_one', [pack('open')]);

    const response = await app.request('/api/v1/credits?gameId=g_one&buildId=build_one', {
      headers: asUser(owner),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, packs: [pack('open')] });
  });

  it('requires a signed-in family member', async () => {
    const { app } = await setup();
    expect((await app.request('/api/v1/credits')).status).toBe(401);
  });

  it("does not expose another family's build through exact-build lookup", async () => {
    const { app, deps } = await setup();
    const otherFamily = 'f_01ARZ3NDEKTSV4RRFFQ69G5FBV';
    deps.db
      .insert(schema.families)
      .values({ id: otherFamily, name: 'Other', ownerUserId: 'u_other', createdAt: now })
      .run();
    addGame(deps, 'g_other', 'build_other', [pack('synty', true)], otherFamily);

    const response = await app.request('/api/v1/credits?gameId=g_other&buildId=build_other', {
      headers: asUser(owner),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'credits_not_found' });
  });

  it('requires game and build identifiers together', async () => {
    const { app } = await setup();
    expect((await app.request('/api/v1/credits?gameId=g_one', { headers: asUser(owner) })).status).toBe(400);
  });
});
