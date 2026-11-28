import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app/app.js';
import { createApp as createGamesHost } from '../../games-host/src/server.js';
import routes from '../src/artifacts/routes.js';
import { bindPreview, issueGrant, validGrant, validPreview } from '../src/artifacts/grants.js';
import { issueSessionGrant } from '../src/artifacts/session-grants.js';
import { setCapability } from '../src/accounts/families.js';
import { setAllowedRole } from '../src/auth/allow-list.js';
import { signIn } from './auth-helpers.js';
import { makeApp } from './helpers.js';
import { registerExistingGame } from '../src/games/register.js';
import { gameMedia } from '../src/games/media.js';
import { ensureMainBranch } from '../src/design/store.js';
import { publish } from '../src/releases/service.js';
import { designDoc, hash, ids, insertBuild, now, setup, sha } from './release-fixtures.js';

const buildId = 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ';
const blob = `${'a'.repeat(64)}.png`;

describe('artifact access', () => {
  it('issues a restart-safe capability from a real authenticated session', async () => {
    const { deps, source } = setup();
    insertBuild(deps, source, { id: buildId });
    const { app } = await makeApp(deps);
    const outbox = () =>
      deps.sqlite.prepare('SELECT text FROM mail_outbox ORDER BY created_at').all() as { text: string }[];
    const { session } = await signIn(app, outbox, 'kevin@example.com');
    const user = deps.db.select().from(schema.user).where(eq(schema.user.email, 'kevin@example.com')).get()!;
    deps.db.update(schema.games).set({ ownerId: user.id }).where(eq(schema.games.id, ids.game)).run();
    deps.db
      .insert(schema.familyMembers)
      .values({ familyId: ids.family, userId: user.id, role: 'member', capability: 'creator', joinedAt: now })
      .run();
    const response = await app.request('/api/v1/artifacts/grant', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: ids.game, buildId }),
    });
    expect(response.status).toBe(200);
    const { grant } = (await response.json()) as { grant: string };
    expect(await validGrant({ ...deps }, grant, ids.game, buildId)).toBe(true);
    setCapability(deps.db, ids.family, user.id, 'creator');
    setAllowedRole(deps.db, 'kevin@example.com', 'maker');
    expect(await validGrant({ ...deps }, grant, ids.game, buildId)).toBe(true);
    const unchanged = await app.request('/api/v1/artifacts/grant', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: ids.game, buildId }),
    });
    expect(((await unchanged.json()) as { grant: string }).grant).toBe(grant);
    setCapability(deps.db, ids.family, user.id, 'player');
    const denied = await app.request('/api/v1/artifacts/grant', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: ids.game, buildId }),
    });
    expect(denied.status).toBe(404);
    setCapability(deps.db, ids.family, user.id, 'creator');
    expect(await validGrant({ ...deps }, grant, ids.game, buildId)).toBe(false);
  });
  it('retains an authorized draft grant across an API restart', async () => {
    const { deps, source } = setup();
    insertBuild(deps, source, { id: buildId });
    deps.db
      .insert(schema.user)
      .values({
        id: ids.user,
        email: 'owner@example.test',
        name: 'Owner',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    deps.db
      .insert(schema.session)
      .values({
        id: 'session-one',
        userId: ids.user,
        token: 'session-token',
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    deps.registry.principalResolvers = [
      async (c) =>
        ['Bearer session-token', 'Bearer rotated-token'].includes(c.req.header('authorization') ?? '')
          ? {
              kind: 'user',
              userId: ids.user,
              familyId: ids.family,
              displayName: 'Owner',
              platformRole: 'none',
              capability: 'creator',
            }
          : null,
    ];
    const grant = issueSessionGrant(deps, 'session-one', ids.user, ids.game, buildId, 'owner');
    expect(await validGrant({ ...deps }, grant, ids.game, buildId)).toBe(true);
    deps.db.update(schema.session).set({ token: 'rotated-token' }).where(eq(schema.session.id, 'session-one')).run();
    expect(await validGrant({ ...deps }, grant, ids.game, buildId)).toBe(true);
    setCapability(deps.db, ids.family, ids.user, 'player');
    setCapability(deps.db, ids.family, ids.user, 'creator');
    expect(await validGrant({ ...deps }, grant, ids.game, buildId)).toBe(false);
  });
  it('renews the same draft URL after a suspended session resumes', async () => {
    vi.useFakeTimers();
    try {
      const { deps, source } = setup();
      insertBuild(deps, source, { id: buildId });
      deps.registry.principalResolvers = [
        async (c) =>
          c.req.header('cookie') === 'session=owner'
            ? {
                kind: 'user',
                userId: ids.user,
                familyId: ids.family,
                displayName: 'Owner',
                platformRole: 'none',
                capability: 'creator',
              }
            : null,
      ];
      const headers = new Headers({ cookie: 'session=owner' });
      const grant = await issueGrant(deps, ids.game, buildId, ids.user, headers);
      await vi.advanceTimersByTimeAsync(31 * 60_000);
      expect(await issueGrant(deps, ids.game, buildId, ids.user, headers)).toBe(grant);
      expect(await validGrant(deps, grant, ids.game, buildId)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('never reactivates an old preview alias after ownership transfers', async () => {
    const { deps } = setup();
    const newOwner = 'u_00000000-0000-4000-8000-000000000099';
    deps.registry.principalResolvers = [
      async (c) => {
        const cookie = c.req.header('cookie');
        if (cookie !== 'session=old' && cookie !== 'session=new') return null;
        return {
          kind: 'user',
          userId: cookie === 'session=old' ? ids.user : newOwner,
          familyId: ids.family,
          displayName: 'Owner',
          platformRole: 'none',
          capability: 'creator',
        };
      },
    ];
    const source = 'pv-00000000-0000-4000-8000-000000000001';
    deps.db
      .insert(schema.familyMembers)
      .values({ familyId: ids.family, userId: newOwner, role: 'member', capability: 'creator', joinedAt: now })
      .run();
    const old = bindPreview(deps, ids.game, source, ids.user, new Headers({ cookie: 'session=old' }));
    expect(await validPreview(deps, ids.game, old)).toBe(source);
    deps.db.update(schema.games).set({ ownerId: newOwner }).where(eq(schema.games.id, ids.game)).run();
    const fresh = bindPreview(deps, ids.game, source, newOwner, new Headers({ cookie: 'session=new' }));
    expect(fresh).not.toBe(old);
    expect(await validPreview(deps, ids.game, old)).toBeNull();
    expect(await validPreview(deps, ids.game, fresh)).toBe(source);
    deps.db.update(schema.games).set({ ownerId: ids.user }).where(eq(schema.games.id, ids.game)).run();
    expect(await validPreview(deps, ids.game, old)).toBeNull();
    expect(bindPreview(deps, ids.game, source, ids.user, new Headers({ cookie: 'session=old' }))).not.toBe(old);
  });
  it('requires an explicit tested build and snapshot for a registered listed game', async () => {
    const { deps, source, runtime } = setup();
    const game = registerExistingGame(deps.db, {
      familyId: ids.family,
      ownerId: ids.user,
      title: 'Imported',
      repo: { owner: 'example', name: 'games', path: 'games/imported' },
      visibility: 'listed',
      daemon: { port: 43210, checkoutPath: '/srv/game', unit: 'example', envFile: '/srv/env' },
    });
    const app = createApp(deps);
    app.route('/api/v1/artifacts', routes);
    const authorize = async () =>
      (
        (await (
          await app.request('/api/v1/artifacts/authorize', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ gameId: game.id, buildId }),
          })
        ).json()) as { allowed: boolean }
      ).allowed;
    expect(await authorize()).toBe(false);
    const branchId = 'b_01H7KMW81X8QF3B2N5D6V9C0AZ';
    ensureMainBranch(deps.sqlite, game.id, { id: branchId, now: new Date(now) });
    const directory = join(deps.config.gamesRoot, game.id, buildId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, '.complete'), 'complete');
    writeFileSync(join(directory, 'index.html'), '<h1>imported</h1>');
    deps.db
      .insert(schema.builds)
      .values({
        id: buildId,
        gameId: game.id,
        branchId,
        gitSha: sha,
        sdkVersion: '1.0.0',
        saveSchemaVersion: 1,
        achievementCatalogHash: hash,
        status: 'tested',
        artifact: 'present',
        artifactPath: directory,
        createdAt: now,
      })
      .run();
    source.set(game.id, buildId, designDoc());
    expect(await authorize()).toBe(false);
    const release = await publish(deps, runtime, { gameId: game.id, buildId, actor: ids.user });
    expect(release.buildId).toBe(buildId);
    expect(deps.db.select().from(schema.overrideSnapshots).all()).toHaveLength(1);
    expect(await authorize()).toBe(true);
  });
  it('requires a release or a live creator session and limits shared blobs to release references', async () => {
    const { deps, source } = setup();
    insertBuild(deps, source, { id: buildId });
    const dir = join(deps.config.gamesRoot, ids.game, buildId);
    mkdirSync(join(dir, 'assets'), { recursive: true });
    mkdirSync(join(deps.config.gamesRoot, '_a'), { recursive: true });
    writeFileSync(join(deps.config.gamesRoot, '_a', blob), 'legacy');
    writeFileSync(join(dir, '.complete'), 'complete');
    const phase = () => ({
      boot: { bytes: 0, files: 0 },
      ready: { bytes: 0, files: 0 },
      stream: { bytes: 0, files: 0 },
    });
    writeFileSync(
      join(dir, 'assets/cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: ids.game,
        buildId,
        built: now,
        sdkVersion: '1.0.0',
        tiers: ['desktop'],
        totals: { desktop: phase(), mobile: phase(), low: phase() },
        entries: [
          { sha256: 'a'.repeat(64), url: `/a/${blob}`, bytes: 1, kind: 'sprite', phase: 'ready', tiers: ['*'] },
        ],
      }),
    );
    let creator = true;
    deps.registry.principalResolvers = [
      async (c) =>
        c.req.header('cookie') === 'session=owner'
          ? {
              kind: 'user',
              userId: ids.user,
              familyId: ids.family,
              displayName: 'Owner',
              platformRole: 'none',
              capability: creator ? 'creator' : 'player',
            }
          : null,
    ];
    const app = createApp(deps);
    app.route('/api/v1/artifacts', routes);
    const post = (path: string, body: object, cookie?: string) =>
      app.request(`/api/v1/artifacts/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    const allowed = async (body: object) =>
      ((await (await post('authorize', body)).json()) as { allowed: boolean }).allowed;
    writeFileSync(
      join(dir, 'index.html'),
      `<img src="/a/${blob}"><script src="/g/${ids.game}/${buildId}/module.js"></script>`,
    );
    const host = createGamesHost({
      root: deps.config.gamesRoot,
      appOrigin: 'https://app.example.test',
      version: 'test',
      workerScript: join(dir, 'unused'),
      authorize: allowed,
      resolvePreview: async (gameId, preview) => {
        const response = await post('authorize', { gameId, preview });
        const result = (await response.json()) as { previewAccessId?: string };
        return result.previewAccessId ?? null;
      },
    });
    expect((await host.request(`/g/${ids.game}/${buildId}/`)).status).toBe(404);
    expect(await allowed({ gameId: ids.game, buildId })).toBe(false);
    expect(await allowed({ blob })).toBe(false);
    expect((await host.request(`/a/${blob}`)).status).toBe(404);
    const grantResponse = await post('grant', { gameId: ids.game, buildId }, 'session=owner');
    expect(grantResponse.status).toBe(200);
    const { grant } = (await grantResponse.json()) as { grant: string };
    expect(
      ((await (await post('grant', { gameId: ids.game, buildId }, 'session=owner')).json()) as { grant: string }).grant,
    ).toBe(grant);
    expect(await allowed({ gameId: ids.game, buildId, grant })).toBe(true);
    const draft = await host.request(`/d/${ids.game}/${buildId}/${grant}/`);
    expect(draft.status).toBe(200);
    const draftHtml = await draft.text();
    expect(draftHtml).toContain(`./a/${blob}`);
    expect(draftHtml).toContain('./module.js');
    expect((await host.request(`/d/${ids.game}/${buildId}/${grant}/a/${blob}`)).status).toBe(200);
    expect((await host.request(`/d/${ids.game}/${buildId}/${grant}/a/${'c'.repeat(64)}.png`)).status).toBe(404);
    const accessId = 'pv-00000000-0000-4000-8000-000000000001';
    const previewId = 'preview-00000000-0000-4000-8000-000000000001';
    const previewRoot = join(deps.config.gamesRoot, '.previews', ids.game);
    const previewDir = join(previewRoot, '.builds', previewId);
    mkdirSync(previewDir, { recursive: true });
    writeFileSync(join(previewDir, '.complete'), 'complete');
    writeFileSync(join(previewDir, 'index.html'), '<h1>preview</h1>');
    writeFileSync(
      join(previewRoot, '1.json'),
      JSON.stringify({
        gameId: ids.game,
        accessId,
        buildId: previewId,
        answered: false,
        accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const alias = bindPreview(deps, ids.game, accessId, ids.user, new Headers({ cookie: 'session=owner' }));
    expect((await host.request(`/p/${ids.game}/${accessId}/`)).status).toBe(404);
    expect((await host.request(`/p/${ids.game}/${alias}/`)).status).toBe(200);
    creator = false;
    expect(await allowed({ gameId: ids.game, buildId, grant })).toBe(false);
    expect((await host.request(`/d/${ids.game}/${buildId}/${grant}/`)).status).toBe(404);
    expect((await host.request(`/p/${ids.game}/${alias}/`)).status).toBe(404);
    deps.db.update(schema.games).set({ visibility: 'listed' }).where(eq(schema.games.id, ids.game)).run();
    expect(await allowed({ gameId: ids.game, buildId })).toBe(false);
    deps.db
      .insert(schema.overrideSnapshots)
      .values({
        id: 'snap_1',
        gameId: ids.game,
        branchId: ids.main,
        buildId,
        headRev: 0,
        sha256: 'b'.repeat(64),
        entriesJson: '[]',
        entityOpsJson: '[]',
        createdAt: now,
      })
      .run();
    deps.db
      .insert(schema.releases)
      .values({
        id: 'rel_1',
        gameId: ids.game,
        seq: 1,
        version: '1.0.0',
        buildId,
        snapshotId: 'snap_1',
        gitTag: 'castle-game/v1.0.0',
        kind: 'publish',
        changelogJson: '{}',
        publishedBy: ids.user,
        publishedAt: now,
      })
      .run();
    deps.db.update(schema.games).set({ publishedReleaseId: 'rel_1' }).where(eq(schema.games.id, ids.game)).run();
    expect(await allowed({ gameId: ids.game, buildId })).toBe(true);
    expect((await host.request(`/g/${ids.game}/${buildId}/`)).status).toBe(200);
    expect(await allowed({ blob })).toBe(true);
    expect((await host.request(`/a/${blob}`)).status).toBe(200);
    const planPath = join(dir, 'assets/cache-plan.json');
    const originalPlan = readFileSync(planPath, 'utf8');
    const changedPlan = JSON.parse(originalPlan) as { entries: unknown[] };
    changedPlan.entries = [
      { sha256: 'd'.repeat(64), url: `/a/${'d'.repeat(64)}.js`, bytes: 1, kind: 'code', phase: 'boot', tiers: ['*'] },
    ];
    writeFileSync(planPath, JSON.stringify(changedPlan));
    expect(await allowed({ blob })).toBe(false);
    creator = true;
    expect((await host.request(`/d/${ids.game}/${buildId}/${grant}/a/${'d'.repeat(64)}.js`)).status).toBe(404);
    creator = false;
    writeFileSync(planPath, originalPlan);
    expect(await allowed({ blob })).toBe(true);
    expect(await allowed({ blob: `${'c'.repeat(64)}.png` })).toBe(false);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ description: 'Released' }));
    insertBuild(deps, source, { id: ids.build2 });
    writeFileSync(
      join(deps.config.gamesRoot, ids.game, ids.build2, 'manifest.json'),
      JSON.stringify({ description: 'Draft' }),
    );
    deps.db.update(schema.branches).set({ latestBuildId: ids.build2 }).where(eq(schema.branches.id, ids.main)).run();
    const viewer = {
      principal: {
        kind: 'user' as const,
        userId: ids.user,
        familyId: ids.family,
        displayName: 'Owner',
        platformRole: 'none' as const,
        capability: 'player' as const,
      },
      headers: new Headers(),
    };
    expect((await gameMedia(deps, [ids.game], viewer)).get(ids.game)).toMatchObject({ tagline: 'Released' });
    deps.db.update(schema.builds).set({ status: 'failed' }).where(eq(schema.builds.id, buildId)).run();
    expect((await gameMedia(deps, [ids.game], viewer)).get(ids.game)).toEqual({});
    deps.db.update(schema.builds).set({ status: 'tested' }).where(eq(schema.builds.id, buildId)).run();
    deps.db
      .update(schema.overrideSnapshots)
      .set({ buildId: ids.build2 })
      .where(eq(schema.overrideSnapshots.id, 'snap_1'))
      .run();
    expect((await gameMedia(deps, [ids.game], viewer)).get(ids.game)).toEqual({});
    deps.db.update(schema.overrideSnapshots).set({ buildId }).where(eq(schema.overrideSnapshots.id, 'snap_1')).run();
    expect(
      (await gameMedia(deps, [ids.game], { ...viewer, principal: { ...viewer.principal, capability: 'creator' } })).get(
        ids.game,
      ),
    ).toMatchObject({ tagline: 'Draft' });
    deps.db.update(schema.games).set({ visibility: 'private' }).where(eq(schema.games.id, ids.game)).run();
    expect(await allowed({ gameId: ids.game, buildId })).toBe(false);
    const otherUser = 'u_00000000-0000-4000-8000-000000000088';
    deps.registry.principalResolvers.push(async (c) =>
      c.req.header('cookie') === 'session=player'
        ? {
            kind: 'user',
            userId: otherUser,
            familyId: ids.family,
            displayName: 'Player',
            platformRole: 'none',
            capability: 'player',
          }
        : null,
    );
    expect((await post('grant', { gameId: ids.game, buildId }, 'session=player')).status).toBe(404);
    deps.db
      .insert(schema.invitations)
      .values({
        id: 'invite_1',
        familyId: ids.family,
        kind: 'play',
        email: 'player@example.test',
        tokenHash: 'hash',
        gameId: ids.game,
        inviterId: ids.user,
        expiresAt: now,
        createdAt: now,
      })
      .run();
    deps.db.insert(schema.gameGrants).values({ gameId: ids.game, userId: otherUser, sourceInviteId: 'invite_1' }).run();
    const otherGrant = (
      (await (await post('grant', { gameId: ids.game, buildId }, 'session=player')).json()) as { grant: string }
    ).grant;
    expect(await allowed({ gameId: ids.game, buildId, grant: otherGrant })).toBe(true);
    deps.db.delete(schema.gameGrants).where(eq(schema.gameGrants.userId, otherUser)).run();
    expect(await allowed({ gameId: ids.game, buildId, grant: otherGrant })).toBe(false);
    const playerGrantResponse = await post('grant', { gameId: ids.game, buildId }, 'session=owner');
    expect(playerGrantResponse.status).toBe(200);
    const playerGrant = ((await playerGrantResponse.json()) as { grant: string }).grant;
    expect(await allowed({ gameId: ids.game, buildId, grant: playerGrant })).toBe(true);
    deps.db.update(schema.games).set({ publishedReleaseId: null }).where(eq(schema.games.id, ids.game)).run();
    expect(await allowed({ gameId: ids.game, buildId, grant: playerGrant })).toBe(false);
  });
  it('keeps a coming soon build off the public path and serves it only to an early-access tester', async () => {
    const { deps, source } = setup();
    insertBuild(deps, source, { id: buildId });
    deps.db
      .insert(schema.overrideSnapshots)
      .values({
        id: 'snap_soon',
        gameId: ids.game,
        branchId: ids.main,
        buildId,
        headRev: 0,
        sha256: 'b'.repeat(64),
        entriesJson: '[]',
        entityOpsJson: '[]',
        createdAt: now,
      })
      .run();
    deps.db
      .insert(schema.releases)
      .values({
        id: 'rel_soon',
        gameId: ids.game,
        seq: 1,
        version: '1.0.0',
        buildId,
        snapshotId: 'snap_soon',
        gitTag: 'castle-game/v1.0.0',
        kind: 'publish',
        changelogJson: '{}',
        publishedBy: ids.user,
        publishedAt: now,
      })
      .run();
    const releaseState = (state: 'released' | 'coming_soon') =>
      deps.db.update(schema.games).set({ releaseState: state }).where(eq(schema.games.id, ids.game)).run();
    deps.db
      .update(schema.games)
      .set({ visibility: 'listed', publishedReleaseId: 'rel_soon' })
      .where(eq(schema.games.id, ids.game))
      .run();
    // A tester in the owner's family: a player who is not the owner, so only early access lets them in.
    const tester = 'u_00000000-0000-4000-8000-000000000077';
    deps.registry.principalResolvers = [
      async (c) =>
        c.req.header('cookie') === 'session=tester'
          ? {
              kind: 'user',
              userId: tester,
              familyId: ids.family,
              displayName: 'Tester',
              platformRole: 'none',
              capability: 'player',
            }
          : null,
    ];
    const app = createApp(deps);
    app.route('/api/v1/artifacts', routes);
    const post = (path: string, body: object, cookie?: string) =>
      app.request(`/api/v1/artifacts/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    const allowed = async (body: object) =>
      ((await (await post('authorize', body)).json()) as { allowed: boolean }).allowed;
    const host = createGamesHost({
      root: deps.config.gamesRoot,
      appOrigin: 'https://app.example.test',
      version: 'test',
      workerScript: join(deps.config.gamesRoot, 'unused'),
      authorize: allowed,
    });

    expect((await host.request(`/g/${ids.game}/${buildId}/`)).status).toBe(200);
    releaseState('coming_soon');
    // The public path is how a listed game reaches anyone: a coming soon game must not be on it.
    expect(await allowed({ gameId: ids.game, buildId })).toBe(false);
    expect((await host.request(`/g/${ids.game}/${buildId}/`)).status).toBe(404);
    expect((await post('grant', { gameId: ids.game, buildId }, 'session=tester')).status).toBe(404);

    deps.db.insert(schema.gameEarlyAccess).values({ gameId: ids.game, userId: tester }).run();
    const grantResponse = await post('grant', { gameId: ids.game, buildId }, 'session=tester');
    expect(grantResponse.status).toBe(200);
    const { grant } = (await grantResponse.json()) as { grant: string };
    expect((await host.request(`/d/${ids.game}/${buildId}/${grant}/`)).status).toBe(200);

    // Revoking early access revokes the URL already in the tester's frame.
    deps.db.delete(schema.gameEarlyAccess).where(eq(schema.gameEarlyAccess.userId, tester)).run();
    expect(await allowed({ gameId: ids.game, buildId, grant })).toBe(false);
    expect((await host.request(`/d/${ids.game}/${buildId}/${grant}/`)).status).toBe(404);

    releaseState('released');
    expect((await host.request(`/g/${ids.game}/${buildId}/`)).status).toBe(200);
  });
});
