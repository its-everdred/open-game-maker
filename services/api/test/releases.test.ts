import type { BoundaryVerdict, CommitOp, CommitResult } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { signJobToken } from '../src/app/job-token.js';
import {
  builderHeaders,
  hash,
  ids,
  insertBuild,
  insertManualTransaction,
  now,
  publish,
  setup,
  sha,
} from './release-fixtures.js';
import { insertBranch } from '../src/design/store.js';
import { asUser, JOB_SECRET, makeApp } from './helpers.js';

describe('release routes', () => {
  it('refuses to publish a tested record whose build files are missing', async () => {
    const { deps, source, operations } = setup();
    insertBuild(deps, source);
    unlinkSync(join(deps.config.gamesRoot, ids.game, ids.build, 'index.html'));
    const { app } = await makeApp(deps);
    const response = await publish(app);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'artifact_missing' });
    expect(deps.db.select().from(schema.releases).all()).toEqual([]);
    expect(operations).toEqual([]);
  });
  it('registers builds for the builder and advances main when testing completes', async () => {
    const { deps, runtime } = setup();
    const { app } = await makeApp(deps);
    const created = await app.request(`/internal/games/${ids.game}/builds`, {
      method: 'POST',
      headers: builderHeaders,
      body: JSON.stringify({
        branchId: ids.main,
        gitSha: sha,
        jobId: ids.job,
        sdkVersion: '1.0.0',
        saveSchemaVersion: 1,
        achievementCatalogHash: hash,
        artifactPath: '/artifacts/build',
        changeNotes: [{ kind: 'add', text: 'A new level' }],
      }),
    });
    expect(created.status).toBe(201);
    const build = (await created.json()) as { id: string; status: string };
    expect(build.status).toBe('building');

    const tested = await app.request(`/internal/builds/${build.id}`, {
      method: 'PATCH',
      headers: builderHeaders,
      body: JSON.stringify({ status: 'tested' }),
    });
    expect(tested.status).toBe(200);
    expect(deps.db.select().from(schema.branches).get()?.latestBuildId).toBe(build.id);
    expect(deps.db.select().from(schema.changeNotes).get()).toMatchObject({ jobId: ids.job, text: 'A new level' });
    expect(runtime.onBuildTested).toHaveBeenCalledWith(ids.game, ids.main, build.id);

    const wrongBranch = await app.request(`/internal/games/${ids.game}/builds`, {
      method: 'POST',
      headers: builderHeaders,
      body: JSON.stringify({
        branchId: 'b_missing',
        gitSha: sha,
        sdkVersion: '1.0.0',
        saveSchemaVersion: 1,
        achievementCatalogHash: hash,
        artifactPath: '/artifacts/missing-branch',
      }),
    });
    expect(wrongBranch.status).toBe(404);
    expect(await wrongBranch.json()).toEqual({ error: 'branch_not_found' });

    const wrongService = await app.request(`/internal/games/${ids.game}/builds`, {
      method: 'POST',
      headers: { ...builderHeaders, 'x-ogm-service': 'commit' },
      body: '{}',
    });
    expect(wrongService.status).toBe(403);

    const unauthenticated = await app.request(`/internal/games/${ids.game}/builds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(unauthenticated.status).toBe(401);
  });

  it('publishes a tested main build through fold then release and moves the pointer', async () => {
    const { deps, source, operations } = setup();
    insertBuild(deps, source);
    const { app } = await makeApp(deps);

    const response = await publish(app);

    expect(response.status).toBe(201);
    const release = await response.json();
    expect(release).toMatchObject({ gameId: ids.game, seq: 1, version: '1.0.0', kind: 'publish' });
    expect(operations.map((op) => op.kind)).toEqual(['fold_design', 'release']);
    expect(operations[1]).toMatchObject({ kind: 'release', semver: '1.0.0' });
    expect(release).toMatchObject({ gitTag: 'castle-game/v1.0.0' });
    expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBe((release as { id: string }).id);
    expect(deps.db.select().from(schema.releases).all()).toHaveLength(1);
    const snapshot = deps.db.select().from(schema.overrideSnapshots).get()!;
    expect(JSON.parse(snapshot.entriesJson)).toEqual([]);
    expect(JSON.parse(snapshot.entityOpsJson)).toEqual([]);
  });

  it.each([
    ['failed', ids.main, 'not_tested'],
    ['tested', ids.branch, 'not_main'],
  ] as const)('refuses a %s build on %s before calling commit', async (status, branchId, error) => {
    const { deps, source, commit } = setup();
    if (branchId === ids.branch) {
      insertBranch(deps.sqlite, {
        id: ids.branch,
        gameId: ids.game,
        name: 'branch',
        gitRef: 'branch/test',
        forkPoint: { parentBranchId: ids.main, parentRev: 0, gitSha: sha },
        headRev: 0,
        latestBuildId: null,
        status: 'active',
        createdBy: ids.user,
        createdAt: now,
      });
    }
    insertBuild(deps, source, { status, branchId });
    const { app } = await makeApp(deps);

    const response = await publish(app);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error });
    expect(commit).not.toHaveBeenCalled();
  });

  it('surfaces a gate verdict without creating a release', async () => {
    const verdict: BoundaryVerdict = {
      allowed: false,
      reasons: [{ code: 'pii', detail: 'these words will be public' }],
    };
    const commit = vi.fn(async (): Promise<CommitResult> => ({ ok: false, verdict }));
    const { deps, source } = setup({ commit: { execute: commit } });
    insertBuild(deps, source);
    const { app } = await makeApp(deps);

    const response = await publish(app);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ verdict });
    expect(deps.db.select().from(schema.releases).all()).toEqual([]);
  });

  it('returns rights failures before any commit-service call', async () => {
    const rights = [{ code: 'rights' as const, path: 'assets/synty.glb', detail: 'Synty cannot be redistributed' }];
    const { deps, source, commit } = setup({ checkRights: vi.fn(async () => rights) });
    deps.db.update(schema.games).set({ repoVisibility: 'public' }).run();
    insertBuild(deps, source);
    const { app } = await makeApp(deps);

    const response = await publish(app);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ rights });
    expect(commit).not.toHaveBeenCalled();
  });

  it('rechecks artifact presence before appending a release', async () => {
    const checkRights = vi.fn(async () => []);
    const { deps, source } = setup({ checkRights });
    checkRights.mockImplementation(async () => {
      deps.db.update(schema.builds).set({ artifact: 'gc' }).where(eq(schema.builds.id, ids.build)).run();
      return [];
    });
    insertBuild(deps, source);
    const { app } = await makeApp(deps);

    const response = await publish(app);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'artifact_missing' });
    expect(deps.db.select().from(schema.releases).all()).toEqual([]);
  });

  it('lets exactly one concurrent publish move the pointer', async () => {
    let rightsCalls = 0;
    let releaseRights!: () => void;
    const rightsReady = new Promise<void>((resolve) => {
      releaseRights = resolve;
    });
    const checkRights = vi.fn(async () => {
      rightsCalls += 1;
      if (rightsCalls === 2) releaseRights();
      await rightsReady;
      return [];
    });
    const { deps, source, commit } = setup({ checkRights });
    insertBuild(deps, source);
    insertBuild(deps, source, { id: ids.build2 });
    const { app } = await makeApp(deps);

    const responses = await Promise.all([publish(app, ids.build), publish(app, ids.build2)]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const failed = responses.find(({ status }) => status === 409)!;
    expect(await failed.json()).toEqual({ error: 'pointer_moved' });
    expect(deps.db.select().from(schema.releases).all()).toHaveLength(1);
    expect(commit.mock.calls.filter(([op]) => op.kind === 'release')).toHaveLength(1);
  });

  it('reuses a successful fold when the release commit is retried', async () => {
    let releaseAttempts = 0;
    const commit = vi.fn(async (op: CommitOp): Promise<CommitResult> => {
      if (op.kind === 'release' && releaseAttempts++ === 0) {
        return { ok: false, verdict: { allowed: false, reasons: [{ code: 'pii', detail: 'edit the notes' }] } };
      }
      return { ok: true, sha: op.kind === 'fold_design' ? 'c'.repeat(40) : 'd'.repeat(40) };
    });
    const { deps, source } = setup({ commit: { execute: commit } });
    insertBuild(deps, source);
    const { app } = await makeApp(deps);

    expect((await publish(app)).status).toBe(403);
    expect((await publish(app)).status).toBe(201);

    expect(commit.mock.calls.map(([op]) => op.kind)).toEqual(['fold_design', 'release', 'release']);
    expect(deps.db.select().from(schema.overrideSnapshots).all()).toHaveLength(1);
  });

  it('assembles and lints changelog notes and main transaction labels', async () => {
    const { deps, source } = setup();
    insertBuild(deps, source);
    deps.db
      .insert(schema.changeNotes)
      .values([
        {
          id: 'note_1',
          gameId: ids.game,
          kind: 'add',
          text: 'New map',
          createdAt: '2026-11-01T20:31:00.000Z',
        },
        { id: 'note_2', gameId: ids.game, kind: 'fix', text: 'Fixed jump', createdAt: now },
      ])
      .run();
    for (const [index, tx] of [ids.tx1, ids.tx2, ids.tx3].entries()) {
      deps.sqlite
        .prepare(
          `INSERT INTO design_transactions
            (id, game_id, branch_id, rev, base_rev, lease_token, actor, kind, label, base_build_id,
             commands_json, patches_json, inverse_json, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, 'manual', ?, ?, '[]', '[]', '[]', ?)`,
        )
        .run(
          tx,
          ids.game,
          ids.main,
          index + 1,
          index,
          ids.user,
          index === 1 ? 'Email kevin@example.com' : `Label ${index + 1}`,
          ids.build,
          now,
        );
    }
    const { app } = await makeApp(deps);

    const response = await publish(app);
    const release = (await response.json()) as { changelog: { items: { text: string }[] } };

    expect(release.changelog.items).toHaveLength(5);
    expect((release as { changelog: { summary: string } }).changelog.summary).toBe('Fixed jump');
    expect(release.changelog.items.map(({ text }) => text)).toContain('(edited)');
    expect(JSON.stringify(release.changelog)).not.toContain('kevin@example.com');
  });

  it('lints supplied changelog URLs and handles and consumes pending notes', async () => {
    const { deps, source } = setup();
    insertBuild(deps, source);
    deps.db
      .insert(schema.changeNotes)
      .values({ id: 'note_pending', gameId: ids.game, kind: 'add', text: 'Pending note', createdAt: now })
      .run();
    const { app } = await makeApp(deps);

    const response = await app.request(`/api/v1/games/${ids.game}/publish`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({
        buildId: ids.build,
        changelog: {
          summary: 'See www.example.test/map',
          items: [{ kind: 'change', text: 'Ask @kevin' }],
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      changelog: { summary: '(edited)', items: [{ kind: 'change', text: '(edited)' }] },
    });
    expect(deps.db.select().from(schema.changeNotes).get()?.releaseId).toEqual(expect.any(String));
  });

  it('leaves notes created during commit for the next release', async () => {
    let releaseStarted!: () => void;
    let finishRelease!: () => void;
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    const commit = vi.fn(async (op: CommitOp): Promise<CommitResult> => {
      if (op.kind === 'release') {
        releaseStarted();
        await finish;
      }
      return { ok: true, sha: op.kind === 'fold_design' ? 'c'.repeat(40) : 'd'.repeat(40) };
    });
    const { deps, source } = setup({ commit: { execute: commit } });
    insertBuild(deps, source);
    deps.db
      .insert(schema.changeNotes)
      .values({ id: 'note_early', gameId: ids.game, kind: 'add', text: 'Early note', createdAt: now })
      .run();
    const { app } = await makeApp(deps);

    const request = publish(app);
    await started;
    deps.db
      .insert(schema.changeNotes)
      .values({ id: 'note_late', gameId: ids.game, kind: 'fix', text: 'Late note', createdAt: now })
      .run();
    finishRelease();
    const response = await request;

    expect((await response.json()) as { changelog: { items: unknown[] } }).toMatchObject({
      changelog: { items: [{ text: 'Early note' }] },
    });
    expect(
      deps.db
        .select({ id: schema.changeNotes.id, releaseId: schema.changeNotes.releaseId })
        .from(schema.changeNotes)
        .all(),
    ).toEqual([
      { id: 'note_early', releaseId: expect.any(String) },
      { id: 'note_late', releaseId: null },
    ]);
  });

  it('rolls back by appending a release and keeps every artifact present', async () => {
    const countSavesAboveSchema = vi.fn(async () => 2);
    const { deps, source } = setup({ countSavesAboveSchema });
    insertBuild(deps, source);
    insertBuild(deps, source, { id: ids.build2, createdAt: '2026-11-01T20:31:00.000Z' });
    const { app } = await makeApp(deps);
    const first = (await (await publish(app, ids.build)).json()) as { id: string };
    insertManualTransaction(deps, { id: ids.tx1, rev: 1, label: 'Second release note' });
    await publish(app, ids.build2);

    const response = await app.request(`/api/v1/games/${ids.game}/rollback`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: first.id }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      version: '3.0.0',
      kind: 'rollback',
      restoresReleaseId: first.id,
      buildId: ids.build,
      affectedSaves: 2,
    });
    expect(deps.db.select({ artifact: schema.builds.artifact }).from(schema.builds).all()).toEqual([
      { artifact: 'present' },
      { artifact: 'present' },
    ]);

    insertManualTransaction(deps, { id: ids.tx2, rev: 2, label: 'After rollback' });
    const afterRollback = (await (await publish(app, ids.build2)).json()) as {
      changelog: { items: { text: string }[] };
    };
    expect(afterRollback.changelog.items.map(({ text }) => text)).toEqual(['After rollback']);
  });

  it('returns the published release with an ETag and honors If-None-Match', async () => {
    const { deps, source } = setup();
    insertBuild(deps, source);
    const { app } = await makeApp(deps);
    expect((await app.request(`/api/v1/games/${ids.game}/published`)).status).toBe(401);
    const never = await app.request(`/api/v1/games/${ids.game}/published`, { headers: asUser(ids.user) });
    expect(never.status).toBe(404);
    const release = (await (await publish(app)).json()) as { id: string };

    const current = await app.request(`/api/v1/games/${ids.game}/published`, { headers: asUser(ids.user) });
    expect(current.status).toBe(200);
    expect(current.headers.get('etag')).toBe(`"${release.id}"`);
    expect(await current.json()).toMatchObject({
      releaseId: release.id,
      version: '1.0.0',
      buildId: ids.build,
      buildUrl: `https://games.example.test/g/${ids.game}/${ids.build}/`,
    });
    const unchanged = await app.request(`/api/v1/games/${ids.game}/published`, {
      headers: { ...asUser(ids.user), 'if-none-match': `"${release.id}"` },
    });
    expect(unchanged.status).toBe(304);

    const releases = await app.request(`/api/v1/games/${ids.game}/releases`, { headers: asUser(ids.user) });
    expect(await releases.json()).toMatchObject({ releases: [{ id: release.id, version: '1.0.0' }] });
  });

  it('accepts change notes only from the job named by its token', async () => {
    const { deps } = setup();
    const { app } = await makeApp(deps);
    const token = signJobToken({ jobId: ids.job, gameId: ids.game, familyId: ids.family }, JOB_SECRET);
    const response = await app.request(`/api/v1/games/${ids.game}/change-notes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'fix', text: 'Fixed the lift' }),
    });

    expect(response.status).toBe(201);
    expect(deps.db.select().from(schema.changeNotes).get()).toMatchObject({
      gameId: ids.game,
      jobId: ids.job,
      kind: 'fix',
      text: 'Fixed the lift',
    });

    const wrongGameToken = signJobToken(
      { jobId: ids.job, gameId: 'g_00000000-0000-4000-8000-000000000099', familyId: ids.family },
      JOB_SECRET,
    );
    const forbidden = await app.request(`/api/v1/games/${ids.game}/change-notes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${wrongGameToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'fix', text: 'Wrong game' }),
    });
    expect(forbidden.status).toBe(403);
  });
});
