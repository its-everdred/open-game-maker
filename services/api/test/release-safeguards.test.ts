import type { CommitOp, CommitResult } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { ids, insertBuild, insertManualTransaction, publish, setup } from './release-fixtures.js';
import { asUser, makeApp } from './helpers.js';
import { publish as publishAutomatically } from '../src/releases/service.js';
import { createVersionCounts } from '../src/branches/version-counts.js';

const refusal = { allowed: false, reasons: [{ code: 'pii' as const, detail: 'these words will be public' }] };

async function rollback(app: Awaited<ReturnType<typeof makeApp>>['app'], releaseId: string) {
  return app.request(`/api/v1/games/${ids.game}/rollback`, {
    method: 'POST',
    headers: { ...asUser(ids.user), 'content-type': 'application/json' },
    body: JSON.stringify({ releaseId }),
  });
}

describe('release safeguards', () => {
  it('does not republish when the owner makes a game private during an automatic release', async () => {
    const { deps, source, runtime } = setup();
    insertBuild(deps, source);
    deps.db.update(schema.games).set({ visibility: 'listed' }).run();
    runtime.commit.execute = async (op) => {
      if (op.kind === 'release') deps.db.update(schema.games).set({ visibility: 'private' }).run();
      return { ok: true, sha: 'c'.repeat(40) };
    };

    await expect(
      publishAutomatically(deps, runtime, {
        gameId: ids.game,
        buildId: ids.build,
        actor: 'system:builder',
        requireListed: true,
      }),
    ).rejects.toMatchObject({ code: 'game_unpublished' });
    expect(deps.db.select().from(schema.games).get()).toMatchObject({
      visibility: 'private',
      publishedReleaseId: null,
    });
    expect(deps.db.select().from(schema.releases).all()).toEqual([]);
  });

  it('does not release a build superseded while its automatic release is prepared', async () => {
    const { deps, source, runtime } = setup();
    insertBuild(deps, source);
    insertBuild(deps, source, { id: ids.build2 });
    deps.db.update(schema.games).set({ visibility: 'listed' }).run();
    deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build, ids.main);
    runtime.commit.execute = async (op) => {
      if (op.kind === 'release')
        deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build2, ids.main);
      return { ok: true, sha: 'c'.repeat(40) };
    };
    await expect(
      publishAutomatically(deps, runtime, {
        gameId: ids.game,
        buildId: ids.build,
        actor: ids.user,
        requireListed: true,
      }),
    ).rejects.toMatchObject({ code: 'build_superseded' });
    expect(deps.db.select().from(schema.releases).all()).toEqual([]);
  });
  // A gate refusal at fold time must not leave a fold SHA that a later publish would trust.
  it('records no fold and no release when the gate refuses fold_design', async () => {
    const commit = vi.fn(async (): Promise<CommitResult> => ({ ok: false, verdict: refusal }));
    const { deps, source } = setup({ commit: { execute: commit } });
    insertBuild(deps, source);
    const { app } = await makeApp(deps);

    const response = await publish(app);

    expect(response.status).toBe(403);
    expect(commit.mock.calls.map(([op]) => (op as CommitOp).kind)).toEqual(['fold_design']);
    expect(deps.db.select().from(schema.overrideSnapshots).get()?.foldSha).toBeNull();
    expect(deps.db.select().from(schema.releases).all()).toEqual([]);
  });

  // Rollback republishes an old artifact; if the repo went public since, its assets must pass the public check.
  it('re-runs the rights check before a rollback', async () => {
    const rights = [{ code: 'rights' as const, path: 'assets/synty.glb', detail: 'Synty cannot be redistributed' }];
    const checkRights = vi.fn(async (_path: string, visibility: 'public' | 'private') =>
      visibility === 'public' ? rights : [],
    );
    const { deps, source, commit } = setup({ checkRights });
    insertBuild(deps, source);
    const { app } = await makeApp(deps);
    const first = (await (await publish(app)).json()) as { id: string };
    deps.db.update(schema.games).set({ repoVisibility: 'public' }).run();

    const response = await rollback(app, first.id);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ rights });
    expect(commit.mock.calls.filter(([op]) => op.kind === 'release')).toHaveLength(1);
    expect(deps.db.select().from(schema.releases).all()).toHaveLength(1);
  });

  // A refused rollback must leave the published pointer on the current release.
  it('keeps the pointer when the gate refuses a rollback release', async () => {
    let releases = 0;
    const commit = vi.fn(async (op: CommitOp): Promise<CommitResult> => {
      if (op.kind === 'release' && ++releases === 2) return { ok: false, verdict: refusal };
      return { ok: true, sha: op.kind === 'fold_design' ? 'c'.repeat(40) : 'd'.repeat(40) };
    });
    const { deps, source } = setup({ commit: { execute: commit } });
    insertBuild(deps, source);
    const { app } = await makeApp(deps);
    const first = (await (await publish(app)).json()) as { id: string };

    const response = await rollback(app, first.id);

    expect(response.status).toBe(403);
    expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBe(first.id);
    expect(deps.db.select().from(schema.releases).all()).toHaveLength(1);
  });

  // An unchanged effective design at a later revision still advances the changelog boundary,
  // so labels already published are not listed again (the fold itself is reused).
  it('does not repeat published labels when the effective design is unchanged', async () => {
    const { deps, source, operations } = setup();
    insertBuild(deps, source);
    const { app } = await makeApp(deps);
    await publish(app);
    insertManualTransaction(deps, { id: ids.tx1, rev: 1, label: 'Tried a change' });
    const second = (await (await publish(app)).json()) as { changelog: { items: { text: string }[] } };
    const third = (await (await publish(app)).json()) as { changelog: { items: { text: string }[] } };

    expect(second.changelog.items.map(({ text }) => text)).toEqual(['Tried a change']);
    expect(third.changelog.items).toEqual([]);
    expect(operations.filter(({ kind }) => kind === 'fold_design')).toHaveLength(1);
  });
});

it('keeps an orphaned tag from blocking a newer automatic release', async () => {
  const { deps, source, runtime } = setup();
  insertBuild(deps, source);
  insertBuild(deps, source, { id: ids.build2 });
  deps.db.update(schema.games).set({ visibility: 'listed' }).run();
  deps.db
    .update(schema.builds)
    .set({ gitSha: 'b'.repeat(40) })
    .where(eq(schema.builds.id, ids.build2))
    .run();
  deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build, ids.main);
  const tags = new Map<string, string>();
  runtime.commit.execute = async (op) => {
    if (op.kind === 'fold_design') return { ok: true, sha: op.base };
    if (op.kind === 'release') {
      const prior = tags.get(op.semver);
      if (prior && prior !== op.sha)
        return { ok: false, verdict: { allowed: false, reasons: [{ code: 'denylist', detail: 'tag exists' }] } };
      tags.set(op.semver, op.sha);
      if (tags.size === 1)
        deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build2, ids.main);
      return { ok: true, sha: op.sha };
    }
    throw new Error('unexpected commit operation');
  };
  await expect(
    publishAutomatically(deps, runtime, { gameId: ids.game, buildId: ids.build, actor: ids.user, requireListed: true }),
  ).rejects.toMatchObject({ code: 'build_superseded' });
  const release = await publishAutomatically(deps, runtime, {
    gameId: ids.game,
    buildId: ids.build2,
    actor: ids.user,
    requireListed: true,
  });
  expect(release.version).toBe('2.0.0');
  await expect(createVersionCounts(deps.sqlite).publishCount(ids.game)).resolves.toBe(2);
  expect([...tags.keys()]).toEqual(['1.0.0', '2.0.0']);
  expect(deps.db.select().from(schema.releases).all()).toHaveLength(1);
});
