import type { CommitOp, CommitResult, DesignDoc } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MemoryBaseDocSource } from '../src/design/base-doc.js';
import { ensureMainBranch } from '../src/design/store.js';
import { setReleaseRuntime, type ReleaseRuntime } from '../src/releases/routes.js';
import { asUser, installUsers, INTERNAL_TOKEN, makeApp, makeDeps } from './helpers.js';

export const ids = {
  family: 'f_00000000-0000-4000-8000-000000000001',
  user: 'u_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  game: 'g_00000000-0000-4000-8000-000000000002',
  main: 'b_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  branch: 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ',
  build: 'build_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  build2: 'build_01BX5ZZKBKACTAV9WEVGEMMVRZ',
  job: 'j_00000000-0000-4000-8000-000000000003',
  tx1: 'tx_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  tx2: 'tx_01BX5ZZKBKACTAV9WEVGEMMVRZ',
  tx3: 'tx_01H7KMW81X8QF3B2N5D6V9C0AZ',
} as const;

export const now = '2026-11-01T20:30:00.000Z';
export const sha = 'a'.repeat(40);
export const hash = 'b'.repeat(64);

export function designDoc(): DesignDoc {
  return { schemaVersion: 1, globals: { 'world.gravity': 9.8 }, entities: {} };
}

export function setup(overrides: Partial<ReleaseRuntime> = {}) {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.user, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: ids.family, userId: ids.user, role: 'owner', capability: 'creator', joinedAt: now })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.user,
      title: 'Game',
      slug: 'castle-game',
      githubPath: 'games/castle-game',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: now,
    })
    .run();
  ensureMainBranch(deps.sqlite, ids.game, { id: ids.main, now: new Date(now) });
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.user,
      displayName: 'Creator',
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'creator@example.test',
    },
  ]);

  const source = new MemoryBaseDocSource();
  const operations: CommitOp[] = [];
  const commit = vi.fn(async (op: CommitOp): Promise<CommitResult> => {
    operations.push(op);
    return { ok: true, sha: op.kind === 'fold_design' ? 'c'.repeat(40) : 'd'.repeat(40) };
  });
  const runtime: ReleaseRuntime = {
    source,
    commit: { execute: commit },
    checkRights: vi.fn(async () => []),
    countSavesAboveSchema: vi.fn(async () => null),
    deriveVersion: ({ publishCount, buildsSinceFork, txSinceLatestBuild }) =>
      `${publishCount}.${buildsSinceFork}.${txSinceLatestBuild}`,
    onBuildTested: vi.fn(async () => undefined),
    gamesOrigin: 'https://games.example.test',
    now: () => new Date(now),
    ...overrides,
  };
  setReleaseRuntime(deps, runtime);
  return { deps, runtime, source, operations, commit };
}

export function insertBuild(
  deps: ReturnType<typeof makeDeps>,
  source: MemoryBaseDocSource,
  input: { id?: string; branchId?: string; status?: 'building' | 'tested' | 'failed'; createdAt?: string } = {},
) {
  const id = input.id ?? ids.build;
  const branchId = input.branchId ?? ids.main;
  const artifactPath = join(deps.config.gamesRoot, ids.game, id);
  mkdirSync(artifactPath, { recursive: true });
  writeFileSync(join(artifactPath, '.complete'), 'complete');
  writeFileSync(join(artifactPath, 'index.html'), '<h1>fixture</h1>');
  deps.db
    .insert(schema.builds)
    .values({
      id,
      gameId: ids.game,
      branchId,
      gitSha: sha,
      sdkVersion: '1.0.0',
      saveSchemaVersion: 1,
      achievementCatalogHash: hash,
      status: input.status ?? 'tested',
      artifact: 'present',
      artifactPath,
      createdAt: input.createdAt ?? now,
    })
    .run();
  source.set(ids.game, id, designDoc());
  return id;
}

export function insertManualTransaction(
  deps: ReturnType<typeof makeDeps>,
  input: { id: string; rev: number; label: string; buildId?: string },
) {
  deps.sqlite
    .prepare(
      `INSERT INTO design_transactions
        (id, game_id, branch_id, rev, base_rev, lease_token, actor, kind, label, base_build_id,
         commands_json, patches_json, inverse_json, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'manual', ?, ?, '[]', '[]', '[]', ?)`,
    )
    .run(
      input.id,
      ids.game,
      ids.main,
      input.rev,
      input.rev - 1,
      ids.user,
      input.label,
      input.buildId ?? ids.build,
      now,
    );
}

export const builderHeaders = {
  authorization: `Bearer ${INTERNAL_TOKEN}`,
  'x-ogm-service': 'builder',
  'content-type': 'application/json',
};

export async function publish(app: Awaited<ReturnType<typeof makeApp>>['app'], buildId = ids.build) {
  return app.request(`/api/v1/games/${ids.game}/publish`, {
    method: 'POST',
    headers: { ...asUser(ids.user), 'content-type': 'application/json' },
    body: JSON.stringify({ buildId }),
  });
}
