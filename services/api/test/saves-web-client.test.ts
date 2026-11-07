import { schema } from '@ogm/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The web player's own save client, run against this app: the 404 and the format mismatch both hid here (#281).
import { getOptionalSaves, getSave, putSave } from '../../../apps/web/src/features/editor/api.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-02T16:00:00.000Z';
const ids = {
  family: 'f_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  game: 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  user: 'u_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  build: 'build_01ARZ3NDEKTSV4RRFFQ69G5FAV',
} as const;

const user: TestUser = {
  kind: 'user',
  userId: ids.user,
  email: 'player@example.test',
  familyId: ids.family,
  platformRole: 'none',
  capability: 'player',
};

async function setup() {
  const deps = makeDeps();
  installUsers(deps, [user]);
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.user, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: ids.family, userId: ids.user, role: 'owner', capability: 'player', joinedAt: now })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.user,
      title: 'Web saves',
      visibility: 'listed',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  return makeApp(deps);
}

/** A browser fetch: signed in as the test user, and gunzipping bodies served with `content-encoding: gzip`. */
function browserFetch(app: Awaited<ReturnType<typeof makeApp>>['app']) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(asUser(ids.user))) headers.set(name, value);
    const response = await app.request(path, { ...init, headers });
    if (response.headers.get('content-encoding') !== 'gzip' || response.body === null) return response;
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
      status: response.status,
      headers: response.headers,
    });
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web save client against the API', () => {
  it('saves a slot, lists it, overwrites it and loads the latest save back', async () => {
    const { app, deps } = await setup();
    vi.stubGlobal('fetch', browserFetch(app));
    const context = { branch: 'main', buildId: ids.build };

    await expect(getOptionalSaves(ids.game)).resolves.toEqual({ available: true, value: { slots: [] } });
    await expect(
      putSave(ids.game, '2', { saveSchemaVersion: 3, data: { room: 'crypt' } }, undefined, context),
    ).resolves.toEqual({ revision: 1 });

    const listed = await getOptionalSaves(ids.game);
    expect(listed).toEqual({
      available: true,
      value: { slots: [expect.objectContaining({ slotId: '2', headRevision: 1, status: 'ok' })] },
    });

    await expect(
      putSave(ids.game, '2', { saveSchemaVersion: 3, data: { room: 'vault' } }, 1, context),
    ).resolves.toEqual({ revision: 2 });
    await expect(getSave(ids.game, '2')).resolves.toEqual({ saveSchemaVersion: 3, data: { room: 'vault' } });

    const mainBranch = deps.sqlite
      .prepare<[string], { id: string }>("SELECT id FROM branches WHERE game_id = ? AND name = 'main'")
      .get(ids.game);
    const stored = deps.sqlite
      .prepare<[], { branch_id: string; build_id: string }>('SELECT branch_id, build_id FROM save_revisions LIMIT 1')
      .get();
    expect(stored).toEqual({ branch_id: mainBranch?.id, build_id: ids.build });
  });

  // The HUD must not offer Load for a slot this build cannot read; the list request carries the build's own schema.
  it('judges a stored slot against the build that is playing', async () => {
    const { app } = await setup();
    vi.stubGlobal('fetch', browserFetch(app));
    const context = { branch: 'main', buildId: ids.build };
    await putSave(ids.game, '2', { saveSchemaVersion: 3, data: { room: 'crypt' } }, undefined, context);

    const listed = (status: string) => ({
      available: true,
      value: { slots: [expect.objectContaining({ slotId: '2', status })] },
    });

    await expect(getOptionalSaves(ids.game, { schema: 3 })).resolves.toEqual(listed('ok'));
    await expect(getOptionalSaves(ids.game, { schema: 4, migratesFrom: 3 })).resolves.toEqual(
      listed('needs_migration'),
    );
    await expect(getOptionalSaves(ids.game, { schema: 2 })).resolves.toEqual(listed('incompatible_after_rollback'));
  });
});
