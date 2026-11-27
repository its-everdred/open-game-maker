import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { ids, insertBuild, insertManualTransaction, now, publish, setup } from './release-fixtures.js';
import { asUser, installUsers, makeApp } from './helpers.js';

const playerId = 'u_01BX5ZZKBKACTAV9WEVGEMMVRZ';

describe('release previews', () => {
  it('previews the publish inputs without changing release state or calling commit', async () => {
    const { deps, source, commit } = setup();
    insertBuild(deps, source);
    deps.db
      .insert(schema.changeNotes)
      .values({ id: 'note_preview', gameId: ids.game, kind: 'add', text: 'New map', createdAt: now })
      .run();
    insertManualTransaction(deps, { id: ids.tx1, rev: 1, label: 'Fixed jump' });
    const { app } = await makeApp(deps);

    const response = await app.request(`/api/v1/games/${ids.game}/publish-preview?buildId=${ids.build}`, {
      headers: asUser(ids.user),
    });

    expect(response.status).toBe(200);
    const preview = await response.json();
    expect(preview).toEqual({
      version: '1.0.0',
      changelog: {
        summary: 'New map',
        items: [
          { kind: 'add', text: 'New map' },
          { txId: ids.tx1, kind: 'change', text: 'Fixed jump' },
        ],
      },
    });
    expect(deps.db.select().from(schema.releases).all()).toEqual([]);
    expect(deps.db.select().from(schema.overrideSnapshots).all()).toEqual([]);
    expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBeNull();
    expect(deps.db.select().from(schema.changeNotes).get()?.releaseId).toBeNull();
    expect(commit).not.toHaveBeenCalled();

    const release = await (await publish(app)).json();
    expect(release).toMatchObject(preview as object);
  });

  it.each([3, null])(
    'previews affected saves as %s without appending a rollback release or calling commit',
    async (affectedSaves) => {
      const countSavesAboveSchema = vi.fn(async () => affectedSaves);
      const { deps, source, commit } = setup({ countSavesAboveSchema });
      insertBuild(deps, source);
      const { app } = await makeApp(deps);
      const first = (await (await publish(app)).json()) as { id: string };
      const second = (await (await publish(app)).json()) as { id: string };
      const commitCalls = commit.mock.calls.length;

      const response = await app.request(`/api/v1/games/${ids.game}/rollback-preview?releaseId=${first.id}`, {
        headers: asUser(ids.user),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ affectedSaves });
      expect(countSavesAboveSchema).toHaveBeenCalledWith(ids.game, 1);
      expect(deps.db.select().from(schema.releases).all()).toHaveLength(2);
      expect(deps.db.select().from(schema.games).get()?.publishedReleaseId).toBe(second.id);
      expect(commit).toHaveBeenCalledTimes(commitCalls);
    },
  );

  it.each([
    ['publish', `/api/v1/games/${ids.game}/publish-preview?buildId=build_missing`, 'build_not_found'],
    ['rollback', `/api/v1/games/${ids.game}/rollback-preview?releaseId=rel_missing`, 'release_not_found'],
  ])('uses the existing missing-id error for %s previews', async (_kind, path, error) => {
    const { deps } = setup();
    const { app } = await makeApp(deps);

    const response = await app.request(path, { headers: asUser(ids.user) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error });
  });

  it.each(['publish-preview?buildId=build_missing', 'rollback-preview?releaseId=rel_missing'])(
    'requires publisher authorization for %s',
    async (path) => {
      const { deps } = setup();
      deps.db
        .insert(schema.familyMembers)
        .values({ familyId: ids.family, userId: playerId, role: 'member', capability: 'player', joinedAt: now })
        .run();
      installUsers(deps, [
        {
          kind: 'user',
          userId: playerId,
          displayName: 'Player',
          familyId: ids.family,
          platformRole: 'none',
          capability: 'player',
          email: 'player@example.test',
        },
      ]);
      const { app } = await makeApp(deps);
      const url = `/api/v1/games/${ids.game}/${path}`;

      const unauthenticated = await app.request(url);
      const forbidden = await app.request(url, { headers: asUser(playerId) });

      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toEqual({ error: 'unauthenticated' });
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toEqual({ error: 'creator_required' });
    },
  );
});
