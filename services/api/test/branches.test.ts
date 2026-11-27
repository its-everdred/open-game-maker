import type { Branch, Transaction } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { createVersionCounts } from '../src/branches/version-counts.js';
import { appendTransaction, ensureMainBranch, insertBranch, listBranches, resolveBranch } from '../src/design/store.js';
import { asUser, installUsers, INTERNAL_TOKEN, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T16:00:00.000Z';
const ids = {
  family: 'f_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  game: 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  creator: 'u_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  other: 'u_01BX5ZZKBKACTAV9WEVGEMMVRZ',
  build: 'build_01ARZ3NDEKTSV4RRFFQ69G5FAV',
} as const;

const creator: TestUser = {
  kind: 'user',
  userId: ids.creator,
  email: 'creator@example.test',
  familyId: ids.family,
  platformRole: 'none',
  capability: 'creator',
};
const other: TestUser = {
  kind: 'user',
  userId: ids.other,
  email: 'other@example.test',
  familyId: ids.family,
  platformRole: 'none',
  capability: 'creator',
};

async function setup() {
  const deps = makeDeps();
  installUsers(deps, [creator, other]);
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.creator, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId: ids.family, userId: ids.creator, role: 'owner', capability: 'creator', joinedAt: now },
      { familyId: ids.family, userId: ids.other, role: 'member', capability: 'creator', joinedAt: now },
    ])
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.creator,
      title: 'Branches test',
      visibility: 'listed',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  const main = ensureMainBranch(deps.sqlite, ids.game, {
    id: 'b_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    now: new Date(now),
  });
  return { ...(await makeApp(deps)), main };
}

function insertBuild(
  deps: ReturnType<typeof makeDeps>,
  input: { branchId: string; gitSha: string; createdAt: string },
): void {
  deps.db
    .insert(schema.builds)
    .values({
      id: ids.build,
      gameId: ids.game,
      branchId: input.branchId,
      gitSha: input.gitSha,
      sdkVersion: '1.0.0',
      saveSchemaVersion: 1,
      achievementCatalogHash: 'b'.repeat(64),
      status: 'tested',
      artifact: 'present',
      artifactPath: `/artifacts/${ids.build}`,
      createdAt: input.createdAt,
    })
    .run();
}

const collectionUrl = `/api/v1/games/${ids.game}/branches`;
const jsonHeaders = (userId = ids.creator) => ({ ...asUser(userId), 'content-type': 'application/json' });

function systemTransaction(
  sqlite: ReturnType<typeof makeDeps>['sqlite'],
  branch: Branch,
  rev: number,
  label: string,
  commands: Transaction['commands'] = [],
) {
  return appendTransaction(
    sqlite,
    {
      gameId: ids.game,
      branchId: branch.id,
      baseRev: rev - 1,
      leaseToken: 0,
      actor: ids.creator,
      kind: 'system',
      label,
      baseBuildId: ids.build,
      commands,
      patches: [{ op: 'add', path: ['globals', `value${rev}`], value: rev }],
      inverse: [{ op: 'remove', path: ['globals', `value${rev}`] }],
    },
    { now: new Date(new Date(now).getTime() + rev) },
  );
}

describe('branch routes', () => {
  it('lists branches with equal creation times in insertion order', async () => {
    const { deps, main } = await setup();
    for (const [id, name] of [
      ['z-branch', 'First'],
      ['a-branch', 'Second'],
    ] as const) {
      insertBranch(deps.sqlite, { ...main, id, name, gitRef: `branch/${id}`, createdAt: now });
    }

    expect(listBranches(deps.sqlite, ids.game).map((branch) => branch.name)).toEqual(['main', 'First', 'Second']);
  });

  it('creates at the parent head and excludes later parent transactions from child replay', async () => {
    const { app, deps, main } = await setup();
    systemTransaction(deps.sqlite, main, 1, 'parent before fork');

    const createdResponse = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Spooky monsters' }),
    });
    expect(createdResponse.status).toBe(201);
    const child = (await createdResponse.json()) as Branch;
    expect(child).toMatchObject({
      name: 'Spooky monsters',
      gitRef: `branch/${child.id}`,
      forkPoint: { parentBranchId: main.id, parentRev: 1, gitSha: null },
      headRev: 0,
      latestBuildId: null,
      status: 'active',
    });

    systemTransaction(deps.sqlite, resolveBranch(deps.sqlite, ids.game, 'main'), 2, 'parent after fork');
    const snapshot = await app.request(`${collectionUrl}/${child.id}/design`, { headers: asUser(ids.creator) });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      rev: 0,
      doc: { globals: { value1: 1 } },
    });

    const grandchild = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'From child', fromBranchId: child.id }),
    });
    expect(grandchild.status).toBe(201);
    expect(await grandchild.json()).toMatchObject({
      forkPoint: { parentBranchId: child.id, parentRev: 0, gitSha: null },
    });
  });

  it('enforces the active cap and lists every active branch in the conflict', async () => {
    const { app } = await setup();
    let firstId = '';
    for (let index = 1; index <= 5; index += 1) {
      const response = await app.request(collectionUrl, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: `Version ${index}` }),
      });
      expect(response.status).toBe(201);
      if (index === 1) firstId = ((await response.json()) as Branch).id;
    }

    const refused = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Version 6' }),
    });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: string; active: Branch[] };
    expect(body.error).toBe('cap_active');
    expect(body.active.map((branch) => branch.name)).toEqual([
      'Version 1',
      'Version 2',
      'Version 3',
      'Version 4',
      'Version 5',
    ]);

    expect(
      (
        await app.request(`${collectionUrl}/${firstId}/archive`, {
          method: 'POST',
          headers: asUser(ids.creator),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(collectionUrl, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ name: 'Replacement' }),
        })
      ).status,
    ).toBe(201);
  });

  it('archives a branch without deleting it and rejects writes to it', async () => {
    const { app } = await setup();
    const created = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Archive me' }),
    });
    const branch = (await created.json()) as Branch;
    const archived = await app.request(`${collectionUrl}/${branch.id}/archive`, {
      method: 'POST',
      headers: asUser(ids.creator),
    });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ id: branch.id, status: 'archived' });

    const write = await app.request(`${collectionUrl}/${branch.id}/transactions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${INTERNAL_TOKEN}`,
        'content-type': 'application/json',
        'x-ogm-service': 'builder',
      },
      body: JSON.stringify({
        baseRev: 0,
        leaseToken: 0,
        kind: 'system',
        actor: ids.creator,
        label: 'should fail',
        baseBuildId: ids.build,
        commands: [],
        patches: [],
        inverse: [],
      }),
    });
    expect(write.status).toBe(409);
    expect(await write.json()).toEqual({ error: 'branch_archived' });

    const listed = await app.request(collectionUrl, { headers: asUser(ids.creator) });
    const listBody = (await listed.json()) as { branches: Array<Branch & { version: string }> };
    expect(listBody.branches).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: branch.id, status: 'archived', version: '0.0.0' })]),
    );
  });

  it('keeps main immutable and validates unique branch names', async () => {
    const { app } = await setup();
    const archiveMain = await app.request(`${collectionUrl}/main/archive`, {
      method: 'POST',
      headers: asUser(ids.creator),
    });
    expect(archiveMain.status).toBe(409);

    const renameMain = await app.request(`${collectionUrl}/main`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Not main' }),
    });
    expect(renameMain.status).toBe(409);

    const tooLong = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'x'.repeat(61) }),
    });
    expect(tooLong.status).toBe(422);

    const controlCharacter = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'bad\nname' }),
    });
    expect(controlCharacter.status).toBe(422);

    const c1ControlCharacter = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'bad\u0085name' }),
    });
    expect(c1ControlCharacter.status).toBe(422);

    const sixtyCodePoints = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: '😀'.repeat(60) }),
    });
    expect(sixtyCodePoints.status).toBe(201);

    expect(
      (
        await app.request(collectionUrl, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ name: 'Unique' }),
        })
      ).status,
    ).toBe(201);
    const duplicate = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'unique' }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'name_taken' });
  });

  it('renames and reads a branch with its derived version', async () => {
    const { app } = await setup();
    const created = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'First name' }),
    });
    const branch = (await created.json()) as Branch;
    const renamed = await app.request(`${collectionUrl}/${branch.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Second name' }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: branch.id, name: 'Second name' });

    const read = await app.request(`${collectionUrl}/${branch.id}`, { headers: asUser(ids.creator) });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ id: branch.id, name: 'Second name', version: '0.0.0' });
  });

  it('copies the parent build id while leaving its unavailable Git SHA null', async () => {
    const { app, deps, main } = await setup();
    deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build, main.id);
    const created = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Built parent' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      latestBuildId: ids.build,
      forkPoint: { parentBranchId: main.id, parentRev: 0, gitSha: null },
    });
  });

  it('copies the Git SHA from the parent build', async () => {
    const { app, deps, main } = await setup();
    const gitSha = 'a'.repeat(40);
    insertBuild(deps, { branchId: main.id, gitSha, createdAt: now });
    deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build, main.id);

    const created = await app.request(collectionUrl, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Built parent' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      latestBuildId: ids.build,
      forkPoint: { parentBranchId: main.id, parentRev: 0, gitSha },
    });
  });

  it('restricts branch reads and mutations to the game owner', async () => {
    const { app } = await setup();
    expect(
      (
        await app.request(collectionUrl, {
          method: 'POST',
          headers: jsonHeaders(ids.other),
          body: JSON.stringify({ name: 'Forbidden' }),
        })
      ).status,
    ).toBe(403);
    expect((await app.request(collectionUrl, { headers: asUser(ids.other) })).status).toBe(403);
  });
});

describe('version counts', () => {
  it('counts only transactions after the latest registered build switch', async () => {
    const { deps, main } = await setup();
    systemTransaction(deps.sqlite, main, 1, 'before one');
    systemTransaction(deps.sqlite, main, 2, 'before two');
    insertBuild(deps, {
      branchId: main.id,
      gitSha: 'a'.repeat(40),
      createdAt: new Date(new Date(now).getTime() + 3).toISOString(),
    });
    deps.sqlite.prepare('UPDATE branches SET latest_build_id = ? WHERE id = ?').run(ids.build, main.id);
    systemTransaction(deps.sqlite, main, 3, 'switch', [{ op: 'invoke', command: 'build.switch', args: {} }]);
    systemTransaction(deps.sqlite, main, 4, 'after one');
    systemTransaction(deps.sqlite, main, 5, 'after two');
    systemTransaction(deps.sqlite, main, 6, 'after three');

    const counts = createVersionCounts(deps.sqlite);
    await expect(counts.publishCount(ids.game)).resolves.toBe(0);
    await expect(counts.buildsSinceFork(main)).resolves.toBe(1);
    await expect(counts.txSinceLatestBuild(main)).resolves.toBe(3);
    await expect(counts.versionFor(main)).resolves.toBe('0.1.3');
  });

  it('counts every transaction when no qualifying build switch exists', async () => {
    const { deps, main } = await setup();
    systemTransaction(deps.sqlite, main, 1, 'first');
    systemTransaction(deps.sqlite, main, 2, 'not a switch marker', [
      { op: 'invoke', command: 'editor.noop', args: {} },
      { op: 'invoke', command: 'build.switch', args: {} },
    ]);
    systemTransaction(deps.sqlite, main, 3, 'third');

    await expect(createVersionCounts(deps.sqlite).txSinceLatestBuild(main)).resolves.toBe(3);
  });
});
