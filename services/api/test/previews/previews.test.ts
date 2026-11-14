import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { schema } from '@ogm/db';
import { createApp as createGamesHost } from '../../../games-host/src/server.js';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import previewRoutes from '../../src/previews/routes.js';
import { previewDirectory } from '../../src/previews/store.js';
import { daemonRowForGame } from '../../src/jobs/daemons.js';
import { createApp } from '../../src/app/app.js';
import { buildRoutes } from '../../src/builds/routes.js';
import { asUser } from '../helpers.js';
import { builtFiles, ids, REPO, SECRET, SHA, world } from '../builds/fixtures.js';

const archive = () => execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', builtFiles(), '.']);

function setup() {
  const { deps } = world();
  const app = createApp(deps);
  app.route(
    '/internal',
    buildRoutes({
      daemonForSecret: async () => null,
      gameForSecret: async (secret) => (secret === SECRET ? { repo: REPO, slug: 'castle-game' } : null),
      trackFor: async (_checkout, _path, _sha, id) => ({
        id,
        phases: [{ id: id === 'sound' ? 'cue' : 'concept', ticket: '12', template: 'next' }],
      }),
    }),
  );
  const [owner, repo] = REPO.split('/');
  deps.db.update(schema.games).set({ githubOwner: owner, githubRepo: repo }).where(eq(schema.games.id, ids.game)).run();
  const message = vi.fn(async () => ({}));
  deps.aiurClientForGame = vi.fn(async () => ({ message }) as never);
  app.route('/api/v1', previewRoutes);
  const upload = (ticket = '12', auth = SECRET, body = archive(), branch = 'main') =>
    app.request(`http://example.test/internal/games/castle-game/previews/${ticket}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth}`, 'x-gm-sha': SHA, 'x-gm-branch': branch },
      body,
    });
  const list = () =>
    app.request(`http://example.test/api/v1/games/${ids.game}/previews`, { headers: asUser(ids.user) });
  const editorList = () =>
    app.request(`http://example.test/api/v1/games/${ids.game}/editor/previews`, { headers: asUser(ids.user) });
  const answer = (buildId: string, note = 'Great') =>
    app.request(`http://example.test/api/v1/games/${ids.game}/previews/12/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ buildId, verdict: 'looks right', note }),
    });
  return { deps, app, upload, list, editorList, answer, message };
}

function enableTracks(deps: ReturnType<typeof setup>['deps']) {
  deps.db
    .insert(schema.gameDaemons)
    .values({
      slug: 'castle-game',
      repo: REPO,
      checkoutPath: '/fixture',
      unit: 'fixture',
      envFile: '/fixture',
      port: 12345,
      status: 'running',
      createdAt: '2026-11-13T00:00:00Z',
    })
    .run();
}

describe('review round previews', () => {
  it('refuses a round from a ticket that does not own the phase', async () => {
    const { app, deps } = setup();
    enableTracks(deps);
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000004',
        track: 'art',
        phase: 'concept',
        category: 'art',
        ticket: '99',
        sha: SHA,
        media: [{ kind: 'still', ref: 'concept' }],
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'track_owner_mismatch' } });
  });
  it('refuses a sound round when the declared capture does not exist', async () => {
    const { app, deps } = setup();
    enableTracks(deps);
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000003',
        track: 'sound',
        phase: 'cue',
        category: 'sound',
        ticket: '12',
        sha: SHA,
        media: [{ kind: 'clip', ref: `sha256:${'a'.repeat(64)}`, hasAudio: true }],
      }),
    });
    expect(response.status).toBe(422);
  });
  it('refuses a gameplay round without a real preview for its ticket and SHA', async () => {
    const { app, deps } = setup();
    enableTracks(deps);
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000002',
        track: 'game',
        phase: 'concept',
        category: 'gameplay',
        ticket: '12',
        sha: SHA,
        media: [{ kind: 'build', ref: 'preview-fake' }],
        question: 'Is it fun?',
      }),
    });
    expect(response.status).toBe(422);
  });
  it('records a verdict against the posted build and retains the prior build', async () => {
    const { deps, app, upload, answer, message } = setup();
    enableTracks(deps);
    const first = (await (await upload()).json()) as { buildId: string };
    const posted = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
        track: 'game',
        phase: 'concept',
        category: 'gameplay',
        ticket: '12',
        sha: SHA,
        media: [{ kind: 'build', ref: first.buildId }],
        question: 'Is it fun?',
      }),
    });
    expect(posted.status).toBe(201);
    expect((await answer(first.buildId, '  Keep this\nexactly.  ')).status).toBe(200);
    expect(message).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.reviewRounds).get()).toMatchObject({
      verdict: 'approved',
      notes: '  Keep this\nexactly.  ',
      verdictSource: 'preview',
    });
    const before = (await (
      await app.request(`http://example.test/api/v1/games/${ids.game}/editor/previews`, { headers: asUser(ids.user) })
    ).json()) as { previews: { accessId: string }[] };
    expect((await upload()).status).toBe(201);
    expect(existsSync(join(previewDirectory(deps, ids.game, first.buildId), 'index.html'))).toBe(true);
    const history = (await (
      await app.request(`http://example.test/api/v1/games/${ids.game}/editor/preview-history`, {
        headers: asUser(ids.user),
      })
    ).json()) as { previews: { buildId: string; accessId: string }[] };
    expect(history.previews).toHaveLength(1);
    expect(history.previews[0]?.buildId).toBe(first.buildId);
    expect(history.previews[0]?.accessId).not.toBe(before.previews[0]?.accessId);
    const host = createGamesHost({
      root: deps.config.gamesRoot,
      appOrigin: 'https://app.example.test',
      version: 'test',
    });
    expect((await host.request(`/p/${ids.game}/${before.previews[0]!.accessId}/index.html`)).status).toBe(404);
    expect((await host.request(`/p/${ids.game}/${history.previews[0]!.accessId}/index.html`)).status).toBe(200);
  });
});

describe('preview builds', () => {
  it('keeps an answered preview available to its branch with a rotated access token', async () => {
    const { deps, upload, list, editorList, answer } = setup();
    const build = (await (await upload('12', SECRET, archive(), 'branch-a')).json()) as { buildId: string };
    const before = (await (await editorList()).json()) as { previews: { branchId: string; accessId: string }[] };
    expect(before.previews[0]?.branchId).toBe('branch-a');
    expect((await answer(build.buildId)).status).toBe(200);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(0);
    const after = (await (await editorList()).json()) as { previews: { branchId: string; accessId: string }[] };
    expect(after.previews[0]?.branchId).toBe('branch-a');
    expect(after.previews[0]?.accessId).not.toBe(before.previews[0]?.accessId);
    expect(existsSync(join(previewDirectory(deps, ids.game, build.buildId), 'index.html'))).toBe(true);
    const host = createGamesHost({
      root: deps.config.gamesRoot,
      appOrigin: 'https://app.example.test',
      version: 'test',
    });
    expect((await host.request(`/p/${ids.game}/${before.previews[0]!.accessId}/index.html`)).status).toBe(404);
    expect((await host.request(`/p/${ids.game}/${after.previews[0]!.accessId}/index.html`)).status).toBe(200);
  });
  it('omits an old answered preview whose build was already removed', async () => {
    const { deps, upload, editorList, answer } = setup();
    const build = (await (await upload()).json()) as { buildId: string };
    expect((await answer(build.buildId)).status).toBe(200);
    rmSync(previewDirectory(deps, ids.game, build.buildId), { recursive: true, force: true });
    expect(((await (await editorList()).json()) as { previews: unknown[] }).previews).toEqual([]);
  });
  it('keeps the live branch untouched, serves the new build, and sends a verdict once', async () => {
    const { deps, app, upload, list, answer, message } = setup();
    expect((await upload('12', 'wrong')).status).toBe(401);
    expect((await app.request(`http://example.test/api/v1/games/${ids.game}/previews`)).status).toBe(401);
    const response = await upload();
    expect(response.status).toBe(201);
    const preview = (await response.json()) as { buildId: string };
    expect(readFileSync(join(previewDirectory(deps, ids.game, preview.buildId), 'index.html'), 'utf8')).toContain(
      'Fixture',
    );
    expect(deps.db.select().from(schema.builds).all()).toEqual([]);
    expect(
      deps.db.select().from(schema.branches).where(eq(schema.branches.id, ids.main)).get()?.latestBuildId,
    ).toBeNull();
    expect((await list()).status).toBe(200);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId)).status).toBe(200);
    expect(message).toHaveBeenCalledWith(
      '12',
      `Preview review of ${preview.buildId}: looks right.\nGreat`,
      `preview:${preview.buildId}`,
      expect.any(AbortSignal),
    );
    expect((await answer(preview.buildId)).status).toBe(409);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(0);
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('reopens on a new push and rejects a verdict for the superseded build', async () => {
    const { upload, list, answer, message } = setup();
    const first = (await (await upload()).json()) as { buildId: string };
    const second = (await (await upload()).json()) as { buildId: string };
    expect(second.buildId).not.toBe(first.buildId);
    expect((await answer(first.buildId)).status).toBe(409);
    expect(message).not.toHaveBeenCalled();
    expect(
      ((await (await list()).json()) as { previews: { buildId: string }[] }).previews.map((p) => p.buildId),
    ).toEqual([second.buildId]);
    expect((await answer(second.buildId)).status).toBe(200);
    expect((await upload()).status).toBe(201);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
  });

  it('keeps a failed delivery in the queue', async () => {
    const { upload, list, answer, message } = setup();
    const preview = (await (await upload()).json()) as { buildId: string };
    message.mockRejectedValueOnce(new Error('offline'));
    expect((await answer(preview.buildId)).status).toBe(500);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId)).status).toBe(200);
  });

  it('keeps an uncertain delivery open for an idempotent retry', async () => {
    const { upload, list, answer, message } = setup();
    const preview = (await (await upload()).json()) as { buildId: string };
    message.mockResolvedValueOnce({ warning: 'outcome_unknown' });
    expect((await answer(preview.buildId)).status).toBe(500);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId, 'Changed')).status).toBe(409);
    expect(message).toHaveBeenCalledTimes(1);
    expect((await answer(preview.buildId)).status).toBe(200);
    expect(message.mock.calls[0]?.[2]).toBe(message.mock.calls[1]?.[2]);
  });
  it('protects preview files and private cache-plan assets with a revocable capability', async () => {
    const { deps, upload, list } = setup();
    const files = builtFiles();
    const bytes = Buffer.from('preview image');
    const hash = createHash('sha256').update(bytes).digest('hex');
    mkdirSync(join(files, 'a'));
    writeFileSync(join(files, 'a', `${hash}.png`), bytes);
    writeFileSync(
      join(files, 'assets', 'manifest.json'),
      JSON.stringify({ files: { [`/a/${hash}.png`]: {} }, assets: { hero: { file: { '*': `/a/${hash}.png` } } } }),
    );
    const phase = () => ({
      boot: { bytes: 0, files: 0 },
      ready: { bytes: bytes.length, files: 1 },
      stream: { bytes: 0, files: 0 },
    });
    writeFileSync(
      join(files, 'assets', 'cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: '',
        buildId: '',
        built: '2026-11-02T20:00:00.000Z',
        sdkVersion: '',
        tiers: ['desktop'],
        entries: [
          { sha256: hash, url: `/a/${hash}.png`, bytes: bytes.length, kind: 'sprite', phase: 'ready', tiers: ['*'] },
        ],
        totals: { desktop: phase(), mobile: phase(), low: phase() },
      }),
    );
    const body = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', files, '.']);
    const response = await upload('12', SECRET, body);
    expect(response.status).toBe(201);
    const preview = (await response.json()) as { buildId: string; accessId?: string };
    expect(preview.accessId).toBeUndefined();
    const accessId = ((await (await list()).json()) as { previews: { accessId: string }[] }).previews[0]!.accessId;
    expect(existsSync(join(deps.config.gamesRoot, '_a', `${hash}.png`))).toBe(false);
    expect(readFileSync(join(previewDirectory(deps, ids.game, preview.buildId), 'a', `${hash}.png`))).toEqual(bytes);
    const host = createGamesHost({
      root: deps.config.gamesRoot,
      appOrigin: 'https://app.example.test',
      version: 'test',
      workerScript: '/missing',
    });
    expect((await host.request(`/g/${ids.game}/${preview.buildId}/index.html`)).status).toBe(404);
    expect((await host.request(`/a/${hash}.png`)).status).toBe(404);
    const url = `/p/${ids.game}/${accessId}`;
    const image = await host.request(`${url}/a/${hash}.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get('cache-control')).toBe('no-store');
    expect(image.headers.get('access-control-allow-origin')).toBe('*');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
    const assetManifest = (await (await host.request(`${url}/assets/manifest.json`)).json()) as {
      assets: { hero: { file: Record<string, string> } };
    };
    expect(assetManifest.assets.hero.file['*']).toBe(`../a/${hash}.png`);
    const cachePlan = (await (await host.request(`${url}/assets/cache-plan.json`)).json()) as {
      entries: { url: string }[];
    };
    expect(cachePlan.entries.some((entry) => entry.url === `../a/${hash}.png`)).toBe(true);
    const html = await host.request(`${url}/index.html`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('<script src="./__ogm_preview_bootstrap.js"></script>');
    const bootstrap = await host.request(`${url}/__ogm_preview_bootstrap.js`);
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get('cache-control')).toBe('no-store');
    expect(bootstrap.headers.get('access-control-allow-origin')).toBe('*');
    expect(await bootstrap.text()).toContain("Object.defineProperty(navigator, 'locks'");
    const metadataPath = join(deps.config.gamesRoot, '.previews', ids.game, '12.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, accessExpiresAt: '2000-01-01T00:00:00.000Z' }));
    expect((await host.request(`${url}/index.html`)).status).toBe(404);
    expect((await host.request(`${url}/__ogm_preview_bootstrap.js`)).status).toBe(404);
    const renewed = ((await (await list()).json()) as { previews: { accessId: string }[] }).previews[0]!.accessId;
    expect(renewed).not.toBe(accessId);
    expect((await host.request(`/p/${ids.game}/${renewed}/index.html`)).status).toBe(200);
    expect((await upload()).status).toBe(201);
    expect((await host.request(`/p/${ids.game}/${renewed}/index.html`)).status).toBe(404);
  });
  it('keeps preview upload and daemon routing working after the game is renamed', async () => {
    const { deps, upload } = setup();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'castle-game',
        repo: REPO,
        checkoutPath: '/fixture',
        unit: 'fixture',
        envFile: '/fixture',
        port: 12345,
        status: 'running',
        createdAt: '2026-11-13T00:00:00.000Z',
      })
      .run();
    deps.db
      .insert(schema.gameSlugs)
      .values({ slug: 'castle-game', gameId: ids.game, createdAt: '2026-11-13T00:00:00.000Z' })
      .run();
    deps.db.update(schema.games).set({ slug: 'new-name' }).where(eq(schema.games.id, ids.game)).run();
    expect(daemonRowForGame(deps.db, ids.game)?.slug).toBe('castle-game');
    expect((await upload()).status).toBe(201);
  });
});
