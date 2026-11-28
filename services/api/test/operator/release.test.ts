import { eq } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@ogm/db';
import { expect, it } from 'vitest';
import { command as checkAssets } from '../../../../packages/gm-cli/src/commands/check/assets.js';
import { createApp } from '../../src/app/app.js';
import artifacts from '../../src/artifacts/routes.js';
import releaseRoutes from '../../src/releases/routes.js';
import operatorRoutes, { prefix } from '../../src/operator/routes.js';
import { INTERNAL_TOKEN } from '../helpers.js';
import { ids, insertBuild, setup } from '../release-fixtures.js';

function installSource(deps: ReturnType<typeof setup>['deps'], ...buildIds: string[]) {
  const checkout = join(deps.config.gamesRoot, '.fixture-checkout');
  const game = join(checkout, 'games', 'castle-game');
  mkdirSync(join(game, 'src'), { recursive: true });
  mkdirSync(join(game, 'design'), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-C',
        checkout,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        encoding: 'utf8',
      },
    ).trim();
  git('init', '-q');
  writeFileSync(join(game, 'src', 'source.ts'), 'committed');
  symlinkSync('missing-scene.json', join(game, 'design', 'scenery.json'));
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  writeFileSync(join(game, 'src', 'source.ts'), 'modified after build');
  deps.db
    .update(schema.games)
    .set({ githubOwner: 'fixture', githubRepo: 'repo' })
    .where(eq(schema.games.id, ids.game))
    .run();
  deps.db
    .insert(schema.gameDaemons)
    .values({
      slug: 'castle-game',
      repo: 'fixture/repo',
      checkoutPath: checkout,
      unit: 'fixture',
      envFile: '/fixture',
      port: 23456,
      status: 'running',
      createdAt: '2026-01-01T00:00:00Z',
    })
    .run();
  for (const id of buildIds) deps.db.update(schema.builds).set({ gitSha: sha }).where(eq(schema.builds.id, id)).run();
}

it('lets the operator release the current tested build without an owner session', async () => {
  const { deps, source, runtime } = setup();
  deps.registry.principalResolvers.push(async (c) =>
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
  );
  const buildId = insertBuild(deps, source);
  const outputAssets = join(deps.config.gamesRoot, ids.game, buildId, 'assets');
  mkdirSync(outputAssets, { recursive: true });
  writeFileSync(join(outputAssets, 'cache-plan.json'), '{}');
  installSource(deps, buildId);
  runtime.checkRights = async (path, visibility) => {
    expect(readFileSync(join(path, 'src', 'source.ts'), 'utf8')).toBe('committed');
    expect(path).not.toBe(join(deps.config.gamesRoot, ids.game, buildId));
    const output: string[] = [];
    const code = await checkAssets.run(
      {
        cwd: path,
        assetsRoot: null,
        skillsDir: null,
        config: { verifySoftwareGl: false, verifyQueue: false },
        json: true,
        limit: 10,
        fields: null,
        out: (line) => output.push(line),
        err: () => {},
        emit: () => {},
        blobRoot: null,
        blocklistFile: null,
      },
      [],
      { publish: true, 'repo-visibility': visibility },
    );
    return code === 0 ? [] : (JSON.parse(output.join('\n')) as { reasons: [] }).reasons;
  };
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, ids.main)).run();
  const app = createApp(deps);
  app.route(prefix, operatorRoutes);
  app.route('/api/v1/artifacts', artifacts);
  app.route('/', releaseRoutes);
  const path = `${prefix}/games/castle-game/builds/${buildId}/release`;
  expect((await app.request(path, { method: 'POST' })).status).toBe(401);
  const headers = { 'x-ogm-internal': INTERNAL_TOKEN };
  expect(
    (await app.request(`${prefix}/games/castle-game/builds/not-current/release`, { method: 'POST', headers })).status,
  ).toBe(409);
  expect((await app.request(path, { method: 'POST', headers })).status).toBe(200);
  expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBeTruthy();
  const authorize = async (grant?: string) =>
    (await (
      await app.request('/api/v1/artifacts/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: ids.game, buildId, ...(grant ? { grant } : {}) }),
      })
    ).json()) as { allowed: boolean };
  expect((await authorize()).allowed).toBe(false);
  const grantResponse = await app.request('/api/v1/artifacts/grant', {
    method: 'POST',
    headers: { cookie: 'session=owner', 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: ids.game, buildId }),
  });
  expect(grantResponse.status).toBe(200);
  const { grant } = (await grantResponse.json()) as { grant: string };
  expect((await authorize(grant)).allowed).toBe(true);
  const publishedResponse = await app.request(`/api/v1/games/${ids.game}/published`, {
    headers: { cookie: 'session=owner', 'if-none-match': '"any"' },
  });
  expect(publishedResponse.status).toBe(200);
  expect(publishedResponse.headers.get('cache-control')).toBe('private, no-store');
  const { buildUrl } = (await publishedResponse.json()) as { buildUrl: string };
  const scopedGrant = new URL(buildUrl).pathname.split('/')[4]!;
  expect(buildUrl).toContain(`/d/${ids.game}/${buildId}/`);
  expect((await authorize(scopedGrant)).allowed).toBe(true);
  deps.db.update(schema.games).set({ visibility: 'listed' }).where(eq(schema.games.id, ids.game)).run();
  expect((await authorize()).allowed).toBe(true);
  expect((await app.request(path, { method: 'POST', headers })).status).toBe(200);
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(1);
  unlinkSync(join(deps.config.gamesRoot, ids.game, buildId, 'index.html'));
  expect((await app.request(path, { method: 'POST', headers })).status).toBe(409);
  deps.db.update(schema.games).set({ delistedAt: new Date().toISOString() }).where(eq(schema.games.id, ids.game)).run();
  expect(await (await app.request(path, { method: 'POST', headers })).json()).toMatchObject({ error: 'game_delisted' });
});

it('leaves the current release unchanged when the rights check is unavailable', async () => {
  const { deps, source } = setup({
    checkRights: async () => {
      throw new Error('unavailable');
    },
  });
  const buildId = insertBuild(deps, source);
  installSource(deps, buildId);
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, ids.main)).run();
  const app = createApp(deps);
  app.route(prefix, operatorRoutes);
  const response = await app.request(`${prefix}/games/castle-game/builds/${buildId}/release`, {
    method: 'POST',
    headers: { 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(response.status).toBe(500);
  expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBeNull();
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(0);
});

it('refuses publication when the recorded source revision cannot be checked', async () => {
  const { deps, source } = setup();
  const buildId = insertBuild(deps, source);
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, ids.main)).run();
  const app = createApp(deps);
  app.route(prefix, operatorRoutes);
  const response = await app.request(`${prefix}/games/castle-game/builds/${buildId}/release`, {
    method: 'POST',
    headers: { 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: 'release_source_unavailable' });
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(0);
});

it('rejects a source archive that Git attributes try to hide', async () => {
  const { deps, source } = setup();
  const buildId = insertBuild(deps, source);
  installSource(deps, buildId);
  const checkout = join(deps.config.gamesRoot, '.fixture-checkout');
  writeFileSync(join(checkout, 'games/castle-game/.gitattributes'), 'src/source.ts export-ignore\n');
  execFileSync('git', ['-C', checkout, 'add', 'games/castle-game/.gitattributes']);
  execFileSync('git', [
    '-C',
    checkout,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'hide source',
  ]);
  const sha = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  deps.db.update(schema.builds).set({ gitSha: sha }).where(eq(schema.builds.id, buildId)).run();
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, ids.main)).run();
  const app = createApp(deps);
  app.route(prefix, operatorRoutes);
  const response = await app.request(`${prefix}/games/castle-game/builds/${buildId}/release`, {
    method: 'POST',
    headers: { 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: 'release_source_unavailable' });
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(0);
});

it('does not release an older build when main moves during the release gate', async () => {
  const { deps, source, runtime } = setup();
  const buildId = insertBuild(deps, source);
  const nextBuildId = insertBuild(deps, source, { id: ids.build2 });
  installSource(deps, buildId, nextBuildId);
  deps.db.update(schema.branches).set({ latestBuildId: buildId }).where(eq(schema.branches.id, ids.main)).run();
  runtime.commit.execute = async (op) => {
    if (op.kind === 'release')
      deps.db.update(schema.branches).set({ latestBuildId: nextBuildId }).where(eq(schema.branches.id, ids.main)).run();
    return { ok: true, sha: 'c'.repeat(40) };
  };
  const app = createApp(deps);
  app.route(prefix, operatorRoutes);
  const response = await app.request(`${prefix}/games/castle-game/builds/${buildId}/release`, {
    method: 'POST',
    headers: { 'x-ogm-internal': INTERNAL_TOKEN },
  });
  expect(response.status).toBe(409);
  expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBeNull();
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(0);
});
