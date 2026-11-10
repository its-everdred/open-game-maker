import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JobBundle } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app/app.js';
import { claimAttachments, storeAttachment } from '../../src/build-chat/attachments.js';
import type { TicketJob } from '../../src/app/registry.js';
import { writeLimits, writePreference } from '../../src/energy/store.js';
import { bundleRoutes, hookSecretFiles } from '../../src/internal/bundle.js';
import { tarGz } from '../../src/internal/tarball.js';
import { setPaidApisDuringGameplay } from '../../src/gameplay/policy.js';
import { ids, insertJob } from '../budget/fixture.js';
import { makeApp, makeDeps } from '../helpers.js';

const SECRET_A = 'hook-secret-of-daemon-a';
const SECRET_B = 'hook-secret-of-daemon-b';
const REPO_A = 'everdred-games/gm-g1';
const REPO_B = 'everdred-games/gm-g2';

function job(overrides: Partial<TicketJob> = {}): TicketJob {
  return {
    jobId: 'j1',
    gameId: 'g1',
    repo: REPO_A,
    kind: 'feature',
    game: { title: 'Castle Run', family: 'chunky-low-poly', pov: 'iso', genre: 'platformer', multiplayer: false },
    ...overrides,
  };
}

// Two daemons with their secret files, as OGM-034 lays them out, and an app with the internal routes mounted.
async function setup(jobs: TicketJob[] = [job()]) {
  const home = mkdtempSync(join(tmpdir(), 'ogm-bundle-home-'));
  const deps = makeDeps();
  for (const [slug, repo, secret, port] of [
    ['everdred-games-gm-g1', REPO_A, SECRET_A, 4101],
    ['everdred-games-gm-g2', REPO_B, SECRET_B, 4102],
  ] as const) {
    mkdirSync(join(home, '.config/ogm/daemons', slug), { recursive: true });
    writeFileSync(join(home, '.config/ogm/daemons', slug, 'hook-secret'), secret, { mode: 0o600 });
    await deps.db.insert(schema.gameDaemons).values({
      slug,
      repo,
      checkoutPath: `/srv/${slug}`,
      unit: `ogm-aiur@${slug}.service`,
      envFile: `/srv/${slug}.env`,
      port,
      status: 'running',
      createdAt: '2026-11-01T00:00:00Z',
    });
  }
  deps.registry.ticketJobResolver = async (repo, identifier) =>
    jobs.find((candidate) => candidate.repo === repo && identifier === '12') ?? null;
  const app = createApp(deps);
  const tgz = tarGz([{ path: 'gm-core/SKILL.md', content: 'core\n' }]);
  app.route(
    '/internal',
    bundleRoutes({ daemonForSecret: hookSecretFiles(home), skills: () => ({ version: '1.0.0', tgz }) }),
  );
  const get = (path: string, secret?: string) =>
    app.request(`http://127.0.0.1:4000${path}`, secret ? { headers: { authorization: `Bearer ${secret}` } } : {});
  return { deps, get, tgz };
}

describe('GET /internal/jobs/by-ticket/:identifier/bundle', () => {
  it('refuses a request without a daemon hook secret', async () => {
    const { get } = await setup();
    expect((await get('/internal/jobs/by-ticket/12/bundle')).status).toBe(401);
    expect((await get('/internal/jobs/by-ticket/12/bundle', 'not-a-daemon-secret')).status).toBe(401);
  });

  it("answers 404 with no detail for a ticket in another daemon's repo", async () => {
    const { get } = await setup([job({ repo: REPO_A })]);
    const response = await get('/internal/jobs/by-ticket/12/bundle', SECRET_B);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('g1');
  });

  it("refuses a resolver answer outside the daemon's repo", async () => {
    const { deps, get } = await setup();
    deps.registry.ticketJobResolver = async () => job({ repo: REPO_B });
    expect((await get('/internal/jobs/by-ticket/12/bundle', SECRET_A)).status).toBe(404);
  });

  it('serves the bundle for a ticket in the daemon repo, with no diagnostics outside repairs', async () => {
    const { get } = await setup([job({ diagnostics: { reportId: 'r1', bundleKey: 'reports/r1.tgz' } })]);
    const response = await get('/internal/jobs/by-ticket/12/bundle', SECRET_A);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JobBundle.parse(body)).toEqual({
      v: 1,
      jobId: 'j1',
      gameId: 'g1',
      repo: REPO_A,
      kind: 'feature',
      skillPackVersion: '1.0.0',
      skillPackUrl: 'http://127.0.0.1:4000/internal/skills/1.0.0.tgz',
      gameContext: {
        title: 'Castle Run',
        family: 'chunky-low-poly',
        pov: 'iso',
        genre: 'platformer',
        multiplayer: false,
        allowAiGeneratedAssets: true,
        paidApisDuringGameplay: false,
        branch: 'main',
        lockfilePath: 'assets.lock.json',
      },
      energy: expect.objectContaining({ level: 'unknown', preference: 'balanced' }),
    });
    expect(JSON.stringify(body)).not.toMatch(/aiur_|ghp_|sk-|@/);
  });

  it("hands the build agent the instance's Energy, without dollars", async () => {
    const { deps, get } = await setup();
    writeLimits(deps.db, { day: 1_000_000, week: null, month: null, voice: null, images: null }, new Date());
    const { energy } = JobBundle.parse(await (await get('/internal/jobs/by-ticket/12/bundle', SECRET_A)).json());
    expect(energy).toMatchObject({ level: 'healthy', windows: [{ window: 'day', usedPercent: 0 }, {}, {}] });
    expect(JSON.stringify(energy)).not.toMatch(/MicroUsd|provider/);
  });

  it("carries the game's AI-generated asset setting for gm searches", async () => {
    const { deps, get } = await setup();
    const at = new Date().toISOString();
    deps.db.insert(schema.families).values({ id: 'f1', name: 'F', ownerUserId: 'u1', createdAt: at }).run();
    deps.db
      .insert(schema.games)
      .values({
        id: 'g1',
        familyId: 'f1',
        ownerId: 'u1',
        title: 'Castle Run',
        visibility: 'private',
        repoVisibility: 'private',
        githubOwner: 'everdred-games',
        githubRepo: 'gm-g1',
        allowAiGeneratedAssets: false,
        createdAt: at,
      })
      .run();

    const context = (await (await get('/internal/jobs/by-ticket/12/bundle', SECRET_A)).json()).gameContext;
    expect(context.allowAiGeneratedAssets).toBe(false);
    const path = '/internal/games/g1/ai-assets';
    expect((await get(path)).status).toBe(401);
    expect((await get(path, SECRET_B)).status).toBe(404);
    expect(await (await get(path, SECRET_A)).json()).toEqual({ allowAiGeneratedAssets: false });
    deps.db.update(schema.games).set({ allowAiGeneratedAssets: true }).run();
    expect(await (await get(path, SECRET_A)).json()).toEqual({ allowAiGeneratedAssets: true });
  });

  it("carries the job creator's own preference, so the agent builds the way they asked", async () => {
    const { deps, get } = await setup();
    const at = new Date().toISOString();
    deps.db
      .insert(schema.families)
      .values({ id: ids.family, name: 'F', ownerUserId: ids.creator, createdAt: at })
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: ids.game,
        familyId: ids.family,
        ownerId: ids.creator,
        title: 'Castle Run',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: at,
      })
      .run();
    insertJob(deps, { id: 'j1' });
    writePreference(deps.db, ids.creator, 'save', new Date());
    writePreference(deps.db, ids.other, 'best', new Date());
    const { energy } = JobBundle.parse(await (await get('/internal/jobs/by-ticket/12/bundle', SECRET_A)).json());
    expect(energy?.preference).toBe('save');
  });

  it('passes repair diagnostics through', async () => {
    const diagnostics = { reportId: 'r1', bundleKey: 'reports/r1.tgz' };
    const { get } = await setup([job({ kind: 'repair', diagnostics })]);
    expect((await (await get('/internal/jobs/by-ticket/12/bundle', SECRET_A)).json()).diagnostics).toEqual(diagnostics);
  });

  it('passes the scope session id through for a scope ticket', async () => {
    const scopeSessionId = 's_88000000-0000-4000-8000-000000000001';
    const jobId = 'j_88000000-0000-4000-8000-000000000001';
    const gameId = 'g_88000000-0000-4000-8000-000000000001';
    const familyId = 'f_88000000-0000-4000-8000-000000000001';
    const creatorId = 'u_88000000-0000-4000-8000-000000000001';
    const { deps, get } = await setup([job({ jobId, gameId, kind: 'scope' })]);
    deps.db
      .insert(schema.families)
      .values({ id: familyId, name: 'Family', ownerUserId: creatorId, createdAt: '2026-11-01T00:00:00.000Z' })
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: gameId,
        familyId,
        ownerId: creatorId,
        title: 'Game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    deps.db
      .insert(schema.jobs)
      .values({
        id: jobId,
        gameId,
        branchId: 'main',
        familyId,
        creatorId,
        kind: 'scope',
        complexity: 1,
        state: 'filed',
        start: 'now',
        slot: 'edit',
        plan: '{}',
        reservation: '{}',
        hardCapMicroUsd: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    deps.db
      .insert(schema.scopeSessions)
      .values({
        id: scopeSessionId,
        gameId,
        creatorId,
        jobId,
        status: 'open',
        choices: JSON.stringify({
          genre: 'platformer',
          vibe: 'cozy',
          family: 'chunky-low-poly',
          world: 'island',
          players: 'single',
          pov: 'isometric',
        }),
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      })
      .run();

    expect((await (await get('/internal/jobs/by-ticket/12/bundle', SECRET_A)).json()).scope_session_id).toBe(
      scopeSessionId,
    );
  });

  it('answers 500 rather than serve a token- or email-shaped value', async () => {
    for (const title of ['ghp_abcdefghijkl', 'kevin@example.com']) {
      const { deps, get } = await setup([job({ game: { ...job().game, title } })]);
      const response = await get('/internal/jobs/by-ticket/12/bundle', SECRET_A);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(title);
      expect(deps.lines.some((line) => line.event === 'bundle_refused')).toBe(true);
    }
  });

  it('serves titles that merely contain a token prefix or an @ sign', async () => {
    for (const title of ['Desk-Dash', 'Task-Force 2', 'Whisk-Tail', 'Meet @ the castle']) {
      const { get } = await setup([job({ game: { ...job().game, title } })]);
      const response = await get('/internal/jobs/by-ticket/12/bundle', SECRET_A);
      expect(response.status).toBe(200);
      expect((await response.json()).gameContext.title).toBe(title);
    }
  });
});

describe('job attachments for the after_create hook', () => {
  const markdown = new TextEncoder().encode('# Castle\n\nTowers at each corner.\n');

  async function attach(deps: ReturnType<typeof makeDeps>, jobId: string, name: string, messageId: string | null) {
    const row = await storeAttachment(deps.sqlite, deps.blobStore, {
      jobId,
      creatorId: 'u1',
      type: 'text/markdown',
      name,
      bytes: markdown,
    });
    if (messageId !== null) claimAttachments(deps.sqlite, { ids: [row.id], jobId, creatorId: 'u1', messageId });
    return row;
  }

  it('lists the files sent with chat messages and serves their bytes only to the owning daemon', async () => {
    const { deps, get } = await setup();
    const sent = await attach(deps, 'j1', 'castle notes.md', 'm_88000000-0000-4000-8000-000000000001');
    const unsent = await attach(deps, 'j1', 'draft.md', null);
    const elsewhere = await attach(deps, 'j2', 'other.md', 'm_88000000-0000-4000-8000-000000000002');

    const bundle = JobBundle.parse(await (await get('/internal/jobs/by-ticket/12/bundle', SECRET_A)).json());
    expect(bundle.attachments).toEqual([
      {
        kind: 'text',
        name: 'castle notes.md',
        blob: sent.id,
        bytes: markdown.byteLength,
        message_id: 'm_88000000-0000-4000-8000-000000000001',
        path: `.gm/inbox/attachments/${sent.id}-castle-notes.md`,
      },
    ]);

    const response = await get(`/internal/jobs/by-ticket/12/attachments/${sent.id}`, SECRET_A);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(markdown);

    expect((await get(`/internal/jobs/by-ticket/12/attachments/${sent.id}`)).status).toBe(401);
    expect((await get(`/internal/jobs/by-ticket/12/attachments/${sent.id}`, SECRET_B)).status).toBe(404);
    expect((await get(`/internal/jobs/by-ticket/12/attachments/${unsent.id}`, SECRET_A)).status).toBe(404);
    expect((await get(`/internal/jobs/by-ticket/12/attachments/${elsewhere.id}`, SECRET_A)).status).toBe(404);
  });

  // The bundle refuses to serve anything token- or email-shaped, so a creator's file name must never stall the job.
  it.each(['kevin@example.com.md', 'sk-learn notes.md', 'ghp_abcdefgh.txt'])(
    'keeps serving the bundle when a file is named %s',
    async (name) => {
      const { deps, get } = await setup();
      const row = await attach(deps, 'j1', name, 'm_88000000-0000-4000-8000-000000000001');
      const response = await get('/internal/jobs/by-ticket/12/bundle', SECRET_A);
      expect(response.status).toBe(200);
      const [listed] = JobBundle.parse(await response.json()).attachments ?? [];
      expect(listed?.name).toBe(row.id);
      expect(listed?.path.startsWith(`.gm/inbox/attachments/${row.id}-`)).toBe(true);
      expect(listed?.path).not.toMatch(/sk-|ghp_|@/);
    },
  );
});

describe('gameplay policy for agents', () => {
  // Agents design no live paid feature unless the instance admin's setting says they may.
  it("carries the instance admin's setting in the bundle and on the live route", async () => {
    const { deps, get } = await setup();
    const bundle = async () => (await (await get('/internal/jobs/by-ticket/12/bundle', SECRET_A)).json()).gameContext;
    expect(await bundle()).toMatchObject({ paidApisDuringGameplay: false });
    expect(await (await get('/internal/gameplay', SECRET_A)).json()).toEqual({ paidApisDuringGameplay: false });

    setPaidApisDuringGameplay(deps.db, true);
    expect(await bundle()).toMatchObject({ paidApisDuringGameplay: true });
    expect(await (await get('/internal/gameplay', SECRET_B)).json()).toEqual({ paidApisDuringGameplay: true });
  });

  it('answers the live route only to a daemon', async () => {
    const { get } = await setup();
    expect((await get('/internal/gameplay')).status).toBe(401);
    expect((await get('/internal/gameplay', 'not-a-daemon-secret')).status).toBe(401);
  });
});

describe('GET /internal/skills/:version.tgz', () => {
  it('serves the current pack to a daemon and unpacks with tar', async () => {
    const { get, tgz } = await setup();
    expect((await get('/internal/skills/1.0.0.tgz')).status).toBe(401);
    expect((await get('/internal/skills/0.9.0.tgz', SECRET_B)).status).toBe(404);
    const response = await get('/internal/skills/1.0.0.tgz', SECRET_B);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/gzip');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.equals(tgz)).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'ogm-skills-x-'));
    writeFileSync(join(dir, 'pack.tgz'), bytes);
    execFileSync('tar', ['-xzf', 'pack.tgz'], { cwd: dir });
    expect(readFileSync(join(dir, 'gm-core/SKILL.md'), 'utf8')).toBe('core\n');
  });
});

describe('internal context', () => {
  it('is mounted at /internal by the route scan and closed without a hook secret', async () => {
    const { app, mounted } = await makeApp();
    expect(mounted).toContainEqual({ prefix: '/internal', file: 'internal/routes.ts' });
    expect((await app.request('/internal/jobs/by-ticket/1/bundle')).status).toBe(401);
  });
});
