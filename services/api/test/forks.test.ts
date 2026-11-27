import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { BoundaryVerdict, CommitOp, CommitResult, DesignDoc } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { registerCatalog } from '../src/achievements/catalog.js';
import { CommitUnavailable } from '../src/releases/commit-client.js';
import { publish } from '../src/releases/service.js';
import { asUser, installUsers, makeApp, type TestUser } from './helpers.js';
import { designDoc, ids, insertBuild, insertManualTransaction, now, setup } from './release-fixtures.js';

const releaseId = 'rel_source';
const snapshotId = 'snap_source';
const foldSha = 'c'.repeat(40);
const commitSha = 'd'.repeat(40);
const assetHash = `sha256:${'e'.repeat(64)}`;
const definitions = [
  {
    key: 'first-dungeon',
    title: 'Into the Dark',
    description: 'Finish the first dungeon',
    icon: 'assets/dungeon.png',
    hidden: false,
  },
];

async function world() {
  const context = setup();
  const { deps, runtime } = context;
  deps.db
    .update(schema.games)
    .set({ title: 'Spooky Castle', visibility: 'listed', repoVisibility: 'public' })
    .where(eq(schema.games.id, ids.game))
    .run();
  // A creator's linked GitHub account is irrelevant now: the instance App owns the repository.
  deps.db
    .insert(schema.githubConnections)
    .values({ userId: ids.user, login: 'octocat', installationId: '123', connectedAt: now })
    .run();

  insertBuild(deps, context.source);
  const artifactPath = join(deps.config.gamesRoot, ids.game, ids.build);
  const doc: DesignDoc = {
    ...designDoc(),
    globals: { ...designDoc().globals, 'uploads.cover': assetHash },
  };
  await mkdir(join(artifactPath, 'design'), { recursive: true });
  await writeFile(join(artifactPath, 'design', 'design.json'), JSON.stringify(doc));
  await writeFile(join(artifactPath, '.complete'), `${now}\n`);
  deps.db.update(schema.builds).set({ artifactPath }).where(eq(schema.builds.id, ids.build)).run();
  deps.db
    .insert(schema.overrideSnapshots)
    .values({
      id: snapshotId,
      gameId: ids.game,
      branchId: ids.main,
      buildId: ids.build,
      headRev: 0,
      sha256: 'f'.repeat(64),
      entriesJson: '[]',
      entityOpsJson: '[]',
      foldSha,
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.releases)
    .values({
      id: releaseId,
      gameId: ids.game,
      seq: 1,
      version: '1.0.0',
      buildId: ids.build,
      snapshotId,
      gitTag: 'gm/source/v1.0.0',
      kind: 'publish',
      changelogJson: JSON.stringify({ summary: 'First release', items: [] }),
      publishedBy: ids.user,
      publishedAt: now,
    })
    .run();
  registerCatalog(deps.db, ids.game, releaseId, definitions, now);
  registerCatalog(
    deps.db,
    ids.game,
    'rel_later',
    [{ ...definitions[0]!, title: 'Changed after the release' }],
    '2026-11-02T01:00:00.000Z',
  );
  runtime.checkRights = vi.fn(async () => []);
  const { app } = await makeApp(deps);
  return { ...context, app, artifactPath, doc };
}

async function fork(
  app: Awaited<ReturnType<typeof makeApp>>['app'],
  body: { releaseId?: string; visibility?: string; name?: string } = {},
  userId = ids.user,
) {
  return app.request(`/api/v1/games/${ids.game}/fork`, {
    method: 'POST',
    headers: { ...asUser(userId), 'content-type': 'application/json' },
    body: JSON.stringify({ releaseId, visibility: 'public', name: 'Spooky fork', ...body }),
  });
}

function seedRuntimeRows(context: Awaited<ReturnType<typeof world>>): void {
  const { deps } = context;
  insertManualTransaction(deps, { id: ids.tx1, rev: 1, label: 'Source draft only' });
  deps.db
    .insert(schema.saveSlots)
    .values({ userId: 'u-player', gameId: ids.game, slotId: 'auto', kind: 'auto', headRevision: 1 })
    .run();
  deps.db
    .insert(schema.saveRevisions)
    .values({
      userId: 'u-player',
      gameId: ids.game,
      slotId: 'auto',
      revision: 1,
      branchId: ids.main,
      buildId: ids.build,
      releaseId,
      saveSchemaVersion: 1,
      payload: Buffer.from('{}'),
      sha256: 'a'.repeat(64),
      deviceId: 'device-1',
      clientSeq: 1,
      reason: 'manual',
      createdAt: now,
    })
    .run();
  deps.db
    .insert(schema.achievementAwards)
    .values({
      userId: 'u-player',
      gameId: ids.game,
      key: definitions[0]!.key,
      releaseId,
      source: 'client',
      awardedAt: now,
    })
    .run();
  deps.db
    .insert(schema.achievementProgress)
    .values({ userId: 'u-player', gameId: ids.game, key: definitions[0]!.key, value: 1 })
    .run();
  deps.db
    .insert(schema.creatorAnalyticsEvents)
    .values({
      id: 'event-source',
      ts: now,
      gameId: ids.game,
      branchId: ids.main,
      releaseId,
      env: 'published',
      pseudoUserId: 'pseudo',
      sessionId: 'session',
      name: 'session_start',
      propsJson: '{}',
    })
    .run();
  deps.db
    .insert(schema.creatorAnalyticsDaily)
    .values({ gameId: ids.game, day: '2026-11-02', releaseId, metric: 'plays', scope: '', value: 1 })
    .run();
}

describe('game forks', () => {
  it('publishes the complete tested build of a fork', async () => {
    const context = await world();
    await writeFile(join(context.artifactPath, 'index.html'), '<h1>Fork</h1>');
    const response = await fork(context.app);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { game: { id: string }; build: { id: string } };
    context.source.set(body.game.id, body.build.id, context.doc);
    const release = await publish(context.deps, context.runtime, {
      gameId: body.game.id,
      buildId: body.build.id,
      actor: ids.user,
    });
    expect(release.buildId).toBe(body.build.id);
  });
  it('forks the exact release and copies no runtime or working data', async () => {
    const context = await world();
    seedRuntimeRows(context);
    const response = await fork(context.app);

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      game: { id: string; name: string; ownerId: string; visibility: string; forkedFrom: unknown };
      build: { id: string; gameId: string; branchId: string; gitSha: string; status: string };
      release: null;
    };
    expect(body).toMatchObject({
      game: {
        name: 'Spooky fork',
        ownerId: ids.user,
        visibility: 'public',
        forkedFrom: { gameId: ids.game, releaseId },
      },
      build: { gameId: body.game.id, gitSha: commitSha, status: 'tested' },
      release: null,
    });
    expect(context.operations).toEqual([
      {
        kind: 'create_game',
        gameId: body.game.id,
        slug: 'spooky-fork',
        templateRef: 'game-2d@1',
        visibility: 'public',
        from: { gameId: ids.game, sha: foldSha },
      },
    ]);

    const game = context.deps.db.select().from(schema.games).where(eq(schema.games.id, body.game.id)).get();
    const branch = context.deps.db.select().from(schema.branches).where(eq(schema.branches.gameId, body.game.id)).get();
    const build = context.deps.db.select().from(schema.builds).where(eq(schema.builds.id, body.build.id)).get();
    expect(game).toMatchObject({
      visibility: 'private',
      repoVisibility: 'public',
      slug: 'spooky-fork',
      githubOwner: 'instance',
      githubRepo: 'games',
      githubPath: 'games/spooky-fork',
      repoUrl: 'https://github.com/instance/games',
      forkedFromGameId: ids.game,
      forkedFromReleaseId: releaseId,
    });
    expect(branch).toMatchObject({ name: 'main', headRev: 0, latestBuildId: body.build.id });
    expect(build).toMatchObject({
      branchId: branch!.id,
      artifactPath: context.artifactPath,
      sdkVersion: '1.0.0',
      saveSchemaVersion: 1,
    });
    expect(await realpath(join(context.deps.config.gamesRoot, body.game.id, body.build.id))).toBe(
      await realpath(context.artifactPath),
    );
    expect(
      context.deps.db
        .select()
        .from(schema.achievementDefs)
        .where(eq(schema.achievementDefs.gameId, body.game.id))
        .all(),
    ).toEqual([expect.objectContaining({ title: definitions[0]!.title, firstReleaseId: releaseId })]);

    for (const table of [
      'design_transactions',
      'save_slots',
      'save_revisions',
      'achievement_awards',
      'achievement_progress',
      'creator_analytics_events',
      'creator_analytics_daily',
    ]) {
      expect(
        context.deps.sqlite
          .prepare<[string], { count: number }>(`SELECT count(*) AS count FROM ${table} WHERE game_id = ?`)
          .get(body.game.id),
      ).toEqual({ count: 0 });
    }
    const design = await context.app.request(`/api/v1/games/${body.game.id}/branches/main/design?rev=0`, {
      headers: asUser(ids.user),
    });
    expect(design.status).toBe(200);
    expect((await design.json()) as { doc: DesignDoc }).toMatchObject({ doc: context.doc });
  });

  it('refuses public rights violations before any commit or row, while allowing private forks', async () => {
    const context = await world();
    const reason = { code: 'rights' as const, path: 'assets/door.fbx', detail: 'Synty redistribution: none' };
    context.runtime.checkRights = vi.fn(async (_path, visibility) => (visibility === 'public' ? [reason] : []));

    const refused = await fork(context.app);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ rights: [reason] });
    expect(context.operations).toEqual([]);
    expect(context.deps.db.select().from(schema.games).all()).toHaveLength(1);

    const allowed = await fork(context.app, { visibility: 'private', name: undefined });
    expect(allowed.status).toBe(201);
    expect(await allowed.json()).toMatchObject({ game: { name: 'Spooky Castle (fork)', visibility: 'private' } });
  });

  it('returns a commit refusal verbatim and persists nothing', async () => {
    const context = await world();
    const verdict: BoundaryVerdict = {
      allowed: false,
      reasons: [{ code: 'denylist', detail: 'fork refused' }],
    };
    context.runtime.commit = { execute: vi.fn(async (): Promise<CommitResult> => ({ ok: false, verdict })) };

    const response = await fork(context.app, { visibility: 'private' });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ verdict });
    expect(context.deps.db.select().from(schema.games).all()).toHaveLength(1);
  });

  it('retries one unavailable commit with the same new game id', async () => {
    const context = await world();
    const seen: CommitOp[] = [];
    context.runtime.commit = {
      execute: vi.fn(async (operation): Promise<CommitResult> => {
        seen.push(operation);
        if (seen.length === 1) throw new CommitUnavailable('temporary');
        return { ok: true, sha: commitSha };
      }),
    };

    expect((await fork(context.app, { visibility: 'private' })).status).toBe(201);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
  });

  it('rejects invalid visibility and names longer than 60 characters before committing', async () => {
    const context = await world();

    expect((await fork(context.app, { visibility: 'listed' })).status).toBe(422);
    expect((await fork(context.app, { name: 'x'.repeat(61) })).status).toBe(422);
    expect(context.operations).toEqual([]);
  });

  it('rejects a foreign release, a player, and a disabled source game', async () => {
    const context = await world();
    context.deps.db
      .insert(schema.games)
      .values({
        id: 'g_other',
        familyId: ids.family,
        ownerId: ids.user,
        title: 'Other',
        visibility: 'listed',
        repoVisibility: 'private',
        createdAt: now,
      })
      .run();
    context.deps.db
      .insert(schema.releases)
      .values({
        id: 'rel_other',
        gameId: 'g_other',
        seq: 1,
        version: '1.0.0',
        buildId: ids.build,
        snapshotId,
        gitTag: 'gm/other/v1.0.0',
        kind: 'publish',
        changelogJson: '{}',
        publishedBy: ids.user,
        publishedAt: now,
      })
      .run();
    expect((await fork(context.app, { releaseId: 'rel_other' })).status).toBe(404);

    const player: TestUser = {
      kind: 'user',
      userId: 'u_player',
      displayName: 'Player',
      email: 'player@example.test',
      familyId: ids.family,
      platformRole: 'none',
      capability: 'player',
    };
    context.deps.db
      .insert(schema.familyMembers)
      .values({ familyId: ids.family, userId: player.userId, role: 'member', capability: 'player', joinedAt: now })
      .run();
    installUsers(context.deps, [player]);
    expect((await fork(context.app, {}, player.userId)).status).toBe(403);
    expect((await fork(context.app, { releaseId: 'missing' }, player.userId)).status).toBe(403);

    context.deps.db.update(schema.games).set({ forkable: false }).where(eq(schema.games.id, ids.game)).run();
    expect((await fork(context.app)).status).toBe(403);
    expect(context.operations).toEqual([]);
  });
});
