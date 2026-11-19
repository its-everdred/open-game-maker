import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { sweepPlaySessions } from '../src/analytics/retention.js';
import { CommitServiceRepoProvisioner, NullRepoProvisioner } from '../src/games/repo-provisioner.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T00:00:00.000Z';
const familyId = 'f-family';
const creator: TestUser = {
  kind: 'user',
  userId: 'u-creator',
  displayName: 'Creator',
  email: 'creator@example.com',
  familyId,
  platformRole: 'none',
  capability: 'creator',
};
const admin: TestUser = {
  kind: 'user',
  userId: 'u-admin',
  displayName: 'Admin',
  email: 'admin@example.com',
  familyId,
  platformRole: 'admin',
  capability: 'creator',
};
const player: TestUser = {
  kind: 'user',
  userId: 'u-player',
  displayName: 'Player',
  email: 'player@example.com',
  familyId,
  platformRole: 'none',
  capability: 'player',
};

function seedFamily(deps: ReturnType<typeof makeDeps>) {
  installUsers(deps, [creator, admin, player]);
  deps.db
    .insert(schema.families)
    .values({ id: familyId, name: 'Household', ownerUserId: admin.userId, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId, userId: admin.userId, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId, userId: creator.userId, role: 'member', capability: 'creator', joinedAt: now },
      { familyId, userId: player.userId, role: 'member', capability: 'player', joinedAt: now },
    ])
    .run();
}

async function createGame(
  app: Awaited<ReturnType<typeof makeApp>>['app'],
  user = creator,
  allowAiGeneratedAssets = true,
) {
  return app.request('/api/v1/games', {
    method: 'POST',
    headers: { ...asUser(user.userId), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Castle Game', repoVisibility: 'private', allowAiGeneratedAssets }),
  });
}

describe('games routes', () => {
  it('records play per user and refuses unauthorized games', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.db
      .insert(schema.games)
      .values({
        id: 'g-play',
        familyId,
        ownerId: creator.userId,
        title: 'Play',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: now,
      })
      .run();
    const { app } = await makeApp(deps);
    expect(
      (await app.request('/api/v1/games/g-play/play', { method: 'POST', headers: asUser(player.userId) })).status,
    ).toBe(403);
    expect(
      (await app.request('/api/v1/games/g-play/play', { method: 'POST', headers: asUser(creator.userId) })).status,
    ).toBe(200);
    deps.db.update(schema.gamePlays).set({ lastPlayedAt: now }).run();
    expect(
      (await app.request('/api/v1/games/g-play/play', { method: 'POST', headers: asUser(creator.userId) })).status,
    ).toBe(200);
    const listed = await app.request('/api/v1/games', { headers: asUser(creator.userId) });
    const body = (await listed.json()) as { games: { id: string; lastPlayedAt: string | null }[] };
    expect(body.games[0]).toMatchObject({ id: 'g-play', lastPlayedAt: expect.any(String) });
    expect(body.games[0]!.lastPlayedAt! > now).toBe(true);
    expect(deps.db.select().from(schema.gamePlays).all()).toHaveLength(1);
    deps.db.update(schema.games).set({ visibility: 'listed' }).run();
    const otherList = await app.request('/api/v1/games', { headers: asUser(player.userId) });
    const otherBody = (await otherList.json()) as { games: { lastPlayedAt: string | null }[] };
    expect(otherBody.games[0]?.lastPlayedAt).toBeNull();
  });

  it('provisions and stores a creator game, then resolves it through the registry', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    const provisioner = new NullRepoProvisioner();
    deps.registry.repoProvisioner = provisioner;
    const { app } = await makeApp(deps);

    // No GitHub connection: the operator installed the App on the instance repository once.
    const response = await createGame(app);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      id: string;
      slug: string;
      repo: { owner: string; name: string; url: string };
    };
    expect(body.repo).toEqual({
      owner: 'instance',
      name: 'games',
      url: 'https://github.com/instance/games',
    });
    expect(provisioner.calls).toEqual([{ id: body.id, title: 'Castle Game', slug: body.slug, visibility: 'private' }]);
    expect(deps.db.select().from(schema.games).get()).toMatchObject({
      id: body.id,
      ownerId: creator.userId,
      githubOwner: 'instance',
      githubRepo: 'games',
      githubPath: `games/${body.slug}`,
      repoUrl: 'https://github.com/instance/games',
      allowAiGeneratedAssets: true,
    });
    await expect(deps.registry.gameResolver?.(body.id)).resolves.toEqual({
      familyId,
      ownerId: creator.userId,
      visibility: 'private',
    });
  });

  it('lists media from the current complete main build', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.registry.repoProvisioner = new NullRepoProvisioner();
    const { app } = await makeApp(deps);
    const created = await createGame(app);
    const { id } = (await created.json()) as { id: string };
    deps.db
      .insert(schema.branches)
      .values({
        id: 'branch-media',
        gameId: id,
        name: 'main',
        gitRef: 'main',
        latestBuildId: 'build1',
        status: 'active',
        createdBy: creator.userId,
        createdAt: now,
      })
      .run();
    const directory = join(deps.config.gamesRoot, id, 'build1');
    mkdirSync(join(directory, 'media'), { recursive: true });
    for (const file of [
      'thumbnail.png',
      'trailer-landscape.mp4',
      'trailer-portrait.mp4',
      'logo.png',
      'loading-portrait.png',
      'loading-landscape.png',
    ])
      writeFileSync(join(directory, 'media', file), file);
    const list = async () =>
      (
        (await (await app.request('/api/v1/games', { headers: asUser(creator.userId) })).json()) as {
          games: Array<Record<string, unknown>>;
        }
      ).games[0]!;
    expect(await list()).not.toHaveProperty('coverUrl');
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ logo: '../logo.png' }));
    writeFileSync(join(directory, '.complete'), '');
    expect(await list()).not.toHaveProperty('logoUrl');
    writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify({ logo: 'media/logo.png', padding: 'x'.repeat(1024 * 1024) }),
    );
    expect(await list()).not.toHaveProperty('logoUrl');
    writeFileSync(
      join(directory, '.ogm-display.json'),
      JSON.stringify({
        logo: 'media/logo.png',
        genres: ['puzzle'],
        loading: { portrait: 'media/loading-portrait.png', landscape: 'media/loading-landscape.png' },
      }),
    );
    writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify({ description: 'Published description', tags: ['Cozy'] }),
    );
    expect(await list()).toMatchObject({
      tagline: 'Published description',
      tags: ['Cozy'],
      logoUrl: expect.any(String),
    });
    expect(
      (await app.request(`/api/v1/games/${id}/play`, { method: 'POST', headers: asUser(creator.userId) })).status,
    ).toBe(200);
    const sources = Object.fromEntries(
      ['avif', 'webp', 'png'].map((format) => [
        format,
        [{ width: 320, path: `media/ogm-variants/${'a'.repeat(64)}.${format}` }],
      ]),
    );
    writeFileSync(
      join(directory, '.ogm-display.json'),
      JSON.stringify({
        logo: 'media/logo.png',
        genres: ['puzzle'],
        description: 'Match colour blobs and drop blocks in a forest duel.',
        tags: ['Versus', 'Cozy'],
        loading: { portrait: 'media/loading-portrait.png', landscape: 'media/loading-landscape.png' },
        images: {
          'media/thumbnail.png': { width: 640, height: 360, sources },
          'media/logo.png': { width: 640, height: 360, sources },
          'media/loading-portrait.png': { width: 640, height: 360, sources },
          'media/loading-landscape.png': { width: 640, height: 360, sources },
        },
      }),
    );
    expect(await list()).toMatchObject({
      coverImage: {
        width: 640,
        sources: {
          avif: [
            { width: 320, path: `https://games.example.test/g/${id}/build1/media/ogm-variants/${'a'.repeat(64)}.avif` },
          ],
        },
      },
      logoImage: { height: 360 },
    });
    const detail = await (await app.request(`/api/v1/games/${id}`, { headers: asUser(creator.userId) })).json();
    expect(detail).toMatchObject({
      loadingUrls: { portrait: `https://games.example.test/g/${id}/build1/media/loading-portrait.png` },
      loadingImages: {
        portrait: {
          sources: {
            avif: [{ path: `https://games.example.test/g/${id}/build1/media/ogm-variants/${'a'.repeat(64)}.avif` }],
          },
        },
      },
    });
    expect(await list()).toMatchObject({
      lastPlayedAt: expect.any(String),
      choices: { genre: ['puzzle'] },
      tagline: 'Match colour blobs and drop blocks in a forest duel.',
      tags: ['Versus', 'Cozy'],
      logoUrl: `https://games.example.test/g/${id}/build1/media/logo.png`,
      coverUrl: `https://games.example.test/g/${id}/build1/media/thumbnail.png`,
      loadingUrls: {
        portrait: `https://games.example.test/g/${id}/build1/media/loading-portrait.png`,
        landscape: `https://games.example.test/g/${id}/build1/media/loading-landscape.png`,
      },
      trailerUrl: `https://games.example.test/g/${id}/build1/media/trailer-landscape.mp4`,
    });
    // An older build's portrait cut is never offered: every game shows its one 16:9 trailer.
    expect(await list()).not.toHaveProperty('portraitTrailerUrl');
    for (const badImage of [
      { width: 0, height: 360, sources },
      { width: 640, height: 360, sources: { ...sources, avif: [] } },
      { width: 640, height: 360, sources: { ...sources, avif: [null] } },
      { width: 640, height: 360, sources: { ...sources, avif: [{ width: 320, path: '../unsafe.avif' }] } },
    ]) {
      writeFileSync(
        join(directory, '.ogm-display.json'),
        JSON.stringify({
          logo: 'media/logo.png',
          images: { 'media/thumbnail.png': badImage },
        }),
      );
      const game = await list();
      expect(game).not.toHaveProperty('coverImage');
      expect(game.coverUrl).toBe(`https://games.example.test/g/${id}/build1/media/thumbnail.png`);
    }
  });

  it('lists plays and the published version as detail stats', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.registry.repoProvisioner = new NullRepoProvisioner();
    const { app } = await makeApp(deps);
    const { id } = (await (await createGame(app)).json()) as { id: string };
    const stats = async () =>
      (
        (await (await app.request('/api/v1/games', { headers: asUser(creator.userId) })).json()) as {
          games: Array<Record<string, unknown>>;
        }
      ).games[0]!.stats;
    // A game nobody has played or published shows no stat cells rather than zeros.
    expect(await stats()).toEqual({});
    deps.db
      .insert(schema.branches)
      .values({
        id: 'branch-stats',
        gameId: id,
        name: 'main',
        gitRef: 'main',
        status: 'active',
        createdBy: creator.userId,
        createdAt: now,
      })
      .run();
    deps.db
      .insert(schema.builds)
      .values({
        id: 'build-stats',
        gameId: id,
        branchId: 'branch-stats',
        gitSha: 'a'.repeat(40),
        sdkVersion: '1.0.0',
        saveSchemaVersion: 1,
        achievementCatalogHash: 'b'.repeat(64),
        status: 'tested',
        artifact: 'present',
        artifactPath: '/artifacts/build-stats',
        createdAt: now,
      })
      .run();
    deps.db
      .insert(schema.overrideSnapshots)
      .values({
        id: 'snap-stats',
        gameId: id,
        branchId: 'branch-stats',
        buildId: 'build-stats',
        headRev: 0,
        sha256: 'c'.repeat(64),
        entriesJson: '[]',
        entityOpsJson: '[]',
        foldSha: 'd'.repeat(40),
        createdAt: now,
      })
      .run();
    deps.db
      .insert(schema.releases)
      .values({
        id: 'rel-stats',
        gameId: id,
        seq: 2,
        version: '2.1.0',
        buildId: 'build-stats',
        snapshotId: 'snap-stats',
        gitTag: `gm/${id}/v2.1.0`,
        kind: 'publish',
        changelogJson: '{"summary":"Updates","items":[]}',
        publishedBy: creator.userId,
        publishedAt: now,
      })
      .run();
    deps.db.update(schema.games).set({ publishedReleaseId: 'rel-stats' }).where(eq(schema.games.id, id)).run();
    const playId = '258db497-0012-41aa-8c12-c69c3a29b503';
    const play = (id: string) =>
      app.request(`/api/v1/games/${id}/play`, {
        method: 'POST',
        headers: { ...asUser(creator.userId), 'x-ogm-play-id': playId },
      });
    expect((await play(id)).status).toBe(200);
    expect((await play(id)).status).toBe(200);
    expect(await stats()).toEqual({ plays: 1, version: '2.1.0' });
    const current = new Date().toISOString();
    deps.db
      .insert(schema.gamePlaySessions)
      .values(
        Array.from({ length: 99 }, (_, i) => ({
          gameId: id,
          id: `other-${i}`,
          userId: creator.userId,
          createdAt: current,
        })),
      )
      .run();
    expect(
      (
        await app.request(`/api/v1/games/${id}/play`, {
          method: 'POST',
          headers: { ...asUser(creator.userId), 'x-ogm-play-id': '258db497-0012-41aa-8c12-c69c3a29b504' },
        })
      ).status,
    ).toBe(200);
    expect(await stats()).toEqual({ plays: 1, version: '2.1.0' });
    deps.db.update(schema.gamePlaySessions).set({ createdAt: '2000-01-01T00:00:00.000Z' }).run();
    expect(sweepPlaySessions(deps.sqlite)).toBe(100);
    expect(await stats()).toEqual({ plays: 1, version: '2.1.0' });
    expect(
      (
        await app.request(`/api/v1/games/${id}/play`, {
          method: 'POST',
          headers: { ...asUser(creator.userId), 'x-ogm-play-id': '258db497-0012-41aa-8c12-c69c3a29b505' },
        })
      ).status,
    ).toBe(200);
    expect(await stats()).toEqual({ plays: 2, version: '2.1.0' });

    const detail = await app.request(`/api/v1/games/${id}`, { headers: asUser(creator.userId) });
    expect(((await detail.json()) as { stats: unknown }).stats).toEqual({ plays: 2, version: '2.1.0' });
  });

  it('refuses game creation by a player before provisioning', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    const provisioner = new NullRepoProvisioner();
    deps.registry.repoProvisioner = provisioner;
    const { app } = await makeApp(deps);
    const response = await createGame(app, player);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'creator_required' });
    expect(provisioner.calls).toEqual([]);
  });

  it('stores and patches the per-game AI-generated asset setting', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.registry.repoProvisioner = new NullRepoProvisioner();
    const { app } = await makeApp(deps);
    const created = await createGame(app, creator, false);
    const body = (await created.json()) as { id: string; allowAiGeneratedAssets: boolean };
    expect(body.allowAiGeneratedAssets).toBe(false);

    const patched = await app.request(`/api/v1/games/${body.id}`, {
      method: 'PATCH',
      headers: { ...asUser(creator.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ allowAiGeneratedAssets: true }),
    });

    expect(patched.status).toBe(200);
    expect((await patched.json()) as { allowAiGeneratedAssets: boolean }).toMatchObject({
      allowAiGeneratedAssets: true,
    });
  });

  it('creates a game for a creator who never connected GitHub', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.registry.repoProvisioner = new NullRepoProvisioner();
    const { app } = await makeApp(deps);
    expect(deps.db.select().from(schema.githubConnections).all()).toEqual([]);
    const response = await createGame(app);
    expect(response.status).toBe(201);
    expect(deps.db.select().from(schema.games).all()).toHaveLength(1);
  });

  it('refuses an admin patch of another adult game', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.db
      .insert(schema.games)
      .values({
        id: 'g-owned',
        familyId,
        ownerId: creator.userId,
        title: 'Original',
        visibility: 'listed',
        repoVisibility: 'private',
        createdAt: now,
      })
      .run();
    const { app } = await makeApp(deps);
    const response = await app.request('/api/v1/games/g-owned', {
      method: 'PATCH',
      headers: { ...asUser(admin.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Taken over' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not_owner' });
  });

  it('returns the game ID when a slow commit service times out', async () => {
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => originalTimeout(10));
    try {
      const deps = makeDeps();
      seedFamily(deps);
      deps.registry.repoProvisioner = new CommitServiceRepoProvisioner({
        baseUrl: 'http://127.0.0.1:4301',
        token: 'token',
        instanceRepo: { owner: 'instance', name: 'games' },
        fetch: async (_input, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('timed out'))),
          ),
      });
      const { app } = await makeApp(deps);
      const response = await createGame(app);
      expect(timeout).toHaveBeenCalledWith(20_000);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: 'repo_provisioning_failed',
        details: { gameId: expect.stringMatching(/^g_/) },
      });
    } finally {
      timeout.mockRestore();
    }
  });

  it('returns a recoverable message when GitHub is rate limited', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.registry.repoProvisioner = new CommitServiceRepoProvisioner({
      baseUrl: 'http://127.0.0.1:4301',
      token: 'token',
      instanceRepo: { owner: 'instance', name: 'games' },
      fetch: async () =>
        new Response(
          JSON.stringify({ ok: false, verdict: { reasons: [{ code: 'denylist', detail: 'github rate limited' }] } }),
          { status: 200 },
        ),
    });
    const { app } = await makeApp(deps);
    const response = await createGame(app);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'repo_provisioning_failed',
      message: 'GitHub is busy. Please try again later.',
      details: { gameId: expect.stringMatching(/^g_/) },
    });
  });

  it('keeps a failed provision row and lets its owner retry', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.registry.repoProvisioner = {
      provision: async () => {
        throw new Error('commit service unavailable');
      },
    };
    const { app } = await makeApp(deps);
    const failed = await createGame(app);
    expect(failed.status).toBe(502);
    const failure = (await failed.json()) as { error: string; details: { gameId: string } };
    expect(failure).toEqual({
      error: 'repo_provisioning_failed',
      details: { gameId: expect.stringMatching(/^g_/) },
    });
    const row = deps.db.select().from(schema.games).get();
    expect(row).toMatchObject({ repoUrl: null, ownerId: creator.userId });
    expect(failure.details.gameId).toBe(row?.id);

    deps.registry.repoProvisioner = new NullRepoProvisioner();
    const retried = await app.request(`/api/v1/games/${row?.id}/provision`, {
      method: 'POST',
      headers: asUser(creator.userId),
    });
    expect(retried.status).toBe(200);
    expect(deps.db.select().from(schema.games).get()?.repoUrl).toBe('https://github.com/instance/games');
  });

  it('does not create a game when the provisioner is unavailable', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    const { app } = await makeApp(deps);
    deps.registry.repoProvisioner = undefined;
    expect((await createGame(app)).status).toBe(503);
    expect(deps.db.select().from(schema.games).all()).toHaveLength(0);
  });

  it('can update a recovered game title while retaining its provisioned folder slug', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    const { app } = await makeApp(deps);
    deps.registry.repoProvisioner = new NullRepoProvisioner();
    const created = await createGame(app);
    const game = (await created.json()) as { id: string; slug: string };
    const patched = await app.request(`/api/v1/games/${game.id}`, {
      method: 'PATCH',
      headers: { ...asUser(creator.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Epic Racing', preserveSlug: true }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: 'Epic Racing', slug: game.slug });
    expect(deps.db.select().from(schema.games).get()).toMatchObject({
      slug: game.slug,
      githubPath: `games/${game.slug}`,
    });
  });

  it('lists family-visible games plus the caller private games', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.db
      .insert(schema.games)
      .values([
        {
          id: 'g-listed',
          familyId,
          ownerId: admin.userId,
          title: 'Listed',
          visibility: 'listed',
          repoVisibility: 'private',
          createdAt: now,
        },
        {
          id: 'g-private-own',
          familyId,
          ownerId: creator.userId,
          title: 'Mine',
          visibility: 'private',
          repoVisibility: 'private',
          createdAt: now,
        },
        {
          id: 'g-private-other',
          familyId,
          ownerId: admin.userId,
          title: 'Hidden',
          visibility: 'private',
          repoVisibility: 'private',
          createdAt: now,
        },
      ])
      .run();
    const { app } = await makeApp(deps);
    const response = await app.request('/api/v1/games', { headers: asUser(creator.userId) });
    expect(((await response.json()) as { games: { id: string }[] }).games.map(({ id }) => id).sort()).toEqual([
      'g-listed',
      'g-private-own',
    ]);
  });

  it('does not load or list a caller-owned game from another family', async () => {
    const deps = makeDeps();
    seedFamily(deps);
    deps.db
      .insert(schema.families)
      .values({ id: 'f-other', name: 'Other', ownerUserId: 'u-other', createdAt: now })
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: 'g-other',
        familyId: 'f-other',
        ownerId: creator.userId,
        title: 'Old family game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: now,
      })
      .run();
    const { app } = await makeApp(deps);
    const listed = await app.request('/api/v1/games', { headers: asUser(creator.userId) });
    expect(await listed.json()).toEqual({ games: [] });
    const fetched = await app.request('/api/v1/games/g-other', { headers: asUser(creator.userId) });
    expect(fetched.status).toBe(404);
    expect(await fetched.json()).toEqual({ error: 'game_not_found' });
  });
});

describe('CommitServiceRepoProvisioner', () => {
  it('posts create_game with the service token and derives the game folder', async () => {
    const requests: { input: string; init?: RequestInit }[] = [];
    const provisioner = new CommitServiceRepoProvisioner({
      baseUrl: 'http://127.0.0.1:4301',
      token: 'secret-token',
      instanceRepo: { owner: 'instance', name: 'games' },
      templateRef: 'templates/custom@v2',
      fetch: async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(JSON.stringify({ ok: true, sha: 'abc' }), { status: 200 });
      },
    });
    await expect(
      provisioner.provision({ id: 'g-1', title: 'Castle', slug: 'castle', visibility: 'public' }),
    ).resolves.toEqual({
      owner: 'instance',
      repo: 'games',
      url: 'https://github.com/instance/games',
      path: 'games/castle',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('http://127.0.0.1:4301/internal/commit');
    expect(requests[0]?.init?.headers).toMatchObject({ authorization: 'Bearer secret-token' });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      kind: 'create_game',
      gameId: 'g-1',
      slug: 'castle',
      visibility: 'public',
      templateRef: 'templates/custom@v2',
    });
  });
});
