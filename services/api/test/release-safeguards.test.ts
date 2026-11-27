import type { CommitOp, CommitResult } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { ids, insertBuild, insertManualTransaction, publish, setup } from './release-fixtures.js';
import { asUser, makeApp } from './helpers.js';
import { publish as publishAutomatically } from '../src/releases/service.js';

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
