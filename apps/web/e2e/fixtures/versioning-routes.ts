import { readFileSync } from 'node:fs';

import type { Page, Route } from '@playwright/test';

import type { Branch, Build, MergePlan, Release } from '@ogm/contracts/browser';

type VersionBranch = Branch & { version: string };
type CapturedBody = Record<string, unknown>;
type MergeFixture = {
  plan: MergePlan;
  mine: DesignSnapshot;
  theirs: DesignSnapshot;
  preview: { previewBuildId: string; rev: number; doc: DesignSnapshot['doc'] };
};
type DesignSnapshot = {
  buildId: string;
  rev: number;
  doc: { schemaVersion: number; globals: object; entities: object };
};

export type VersioningApiFixture = {
  readonly publishes: CapturedBody[];
  readonly rollbacks: CapturedBody[];
  readonly resolveAll: CapturedBody[];
  readonly leases: Array<{ method: string; body: CapturedBody }>;
  readonly lands: CapturedBody[];
  useFiveActiveVersions(): void;
};

const mergeFixture = JSON.parse(readFileSync(new URL('./merge-ae3.json', import.meta.url), 'utf8')) as MergeFixture;
const createdAt = '2026-11-01T00:00:00.000Z';

const branches: VersionBranch[] = [
  versionBranch('main', 'main', '2.1.0', 'build_main'),
  versionBranch('ae3', 'ae3', '0.3.0', 'build_ae3'),
  versionBranch('quiet', 'quiet', '0.1.0', 'build_quiet'),
];

const builds: Build[] = [build('build_main', 'main'), build('build_ae3', 'ae3'), build('build_quiet', 'quiet')];

const releases: Release[] = [
  release('release_200', 1, '2.0.0', 'build_old', 'First public build', '2026-10-29T12:00:00.000Z'),
  release('release_210', 2, '2.1.0', 'build_main', 'Door puzzles', '2026-11-01T12:00:00.000Z'),
];

export async function installVersioningRoutes(page: Page): Promise<VersioningApiFixture> {
  const state = {
    branches: structuredClone(branches),
    plan: structuredClone(mergeFixture.plan),
  };
  const publishes: CapturedBody[] = [];
  const rollbacks: CapturedBody[] = [];
  const resolveAll: CapturedBody[] = [];
  const leases: Array<{ method: string; body: CapturedBody }> = [];
  const lands: CapturedBody[] = [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice('/api/v1'.length);
    const method = request.method();

    if (path === '/notifications/stream') return eventStream(route);
    if (path === '/games/game' && method === 'GET') {
      return json(route, {
        id: 'game',
        familyId: 'family',
        ownerId: 'user',
        title: 'Goblin Cellar',
        visibility: 'private',
        repoVisibility: 'private',
      });
    }
    if (path === '/jobs' && method === 'GET') return json(route, { jobs: [] });
    if (path === '/games/game/published') return json(route, { error: 'not_found' }, 404);
    if (path === '/games/game/saves') return json(route, { error: 'not_found' }, 404);
    if (path === '/games/game/branches' && method === 'GET') return json(route, { branches: state.branches });
    if (path === '/games/game/builds' && method === 'GET') return json(route, { builds });
    if (path === '/games/game/releases' && method === 'GET') return json(route, { releases });

    if (path === '/games/game/publish-preview' && url.searchParams.get('buildId') === 'build_main') {
      return json(route, {
        version: '2.2.0',
        changelog: {
          summary: 'Door puzzles',
          items: [{ kind: 'add', text: 'A locked cellar door' }],
        },
      });
    }
    if (path === '/games/game/publish' && method === 'POST') {
      publishes.push(body(request));
      return json(route, release('release_220', 3, '2.2.0', 'build_main', 'A sharper release note', createdAt));
    }
    if (path === '/games/game/rollback-preview' && url.searchParams.get('releaseId') === 'release_200') {
      return json(route, { affectedSaves: 3 });
    }
    if (path === '/games/game/rollback' && method === 'POST') {
      rollbacks.push(body(request));
      return json(route, release('release_rollback', 3, '2.0.0', 'build_old', 'Restore 2.0.0', createdAt));
    }

    const design = path.match(/^\/games\/game\/branches\/([^/]+)\/design$/);
    if (design && method === 'GET') {
      const branchId = design[1];
      return json(route, branchId === 'ae3' ? mergeFixture.theirs : mergeFixture.mine);
    }

    if (path === '/games/game/branches/main/merges/plan_ae3' && method === 'GET') {
      return json(route, state.plan);
    }
    if (path === '/games/game/branches/main/merges/plan_ae3/resolve-all' && method === 'POST') {
      const requestBody = body(request);
      resolveAll.push(requestBody);
      state.plan = {
        ...state.plan,
        conflicts: state.plan.conflicts.map((conflict) => ({ ...conflict, resolution: 'ours' })),
      };
      return json(route, state.plan);
    }
    if (path === '/games/game/branches/main/merges/plan_ae3/preview' && method === 'POST') {
      state.plan = { ...state.plan, status: 'previewing', previewBuildId: mergeFixture.preview.previewBuildId };
      return json(route, mergeFixture.preview);
    }
    if (path === '/games/game/branches/main/lease' && (method === 'POST' || method === 'DELETE')) {
      leases.push({ method, body: body(request) });
      return json(route, { token: 8, expiresAt: '2026-11-02T12:00:00.000Z' });
    }
    if (path === '/games/game/branches/main/merges/plan_ae3/land' && method === 'POST') {
      lands.push(body(request));
      state.plan = { ...state.plan, status: 'landed' };
      return json(route, { rev: 6 });
    }

    return json(route, { error: 'not_mocked', path, method }, 404);
  });

  return {
    publishes,
    rollbacks,
    resolveAll,
    leases,
    lands,
    useFiveActiveVersions() {
      state.branches = [
        ...structuredClone(branches),
        versionBranch('fast', 'fast', '0.1.0', 'build_fast'),
        versionBranch('tiny', 'tiny', '0.1.0', 'build_tiny'),
      ];
    },
  };
}

function versionBranch(id: string, name: string, version: string, latestBuildId: string): VersionBranch {
  return {
    id,
    gameId: 'game',
    name,
    version,
    gitRef: `refs/heads/${name}`,
    forkPoint: name === 'main' ? null : { parentBranchId: 'main', parentRev: 2, gitSha: null },
    headRev: 4,
    latestBuildId,
    status: 'active',
    createdBy: 'user',
    createdAt,
  };
}

function build(id: string, branchId: string): Build {
  return {
    id,
    gameId: 'game',
    branchId,
    gitSha: 'a'.repeat(40),
    sdkVersion: '1.0.0',
    saveSchemaVersion: 1,
    achievementCatalogHash: 'b'.repeat(64),
    status: 'tested',
    artifact: 'present',
    createdAt,
  };
}

function release(
  id: string,
  seq: number,
  version: string,
  buildId: string,
  summary: string,
  publishedAt: string,
): Release {
  return {
    id,
    gameId: 'game',
    seq,
    version,
    buildId,
    snapshotId: `snapshot_${seq}`,
    gitTag: `v${version}`,
    kind: 'publish',
    changelog: { summary, items: [] },
    publishedBy: 'user',
    publishedAt,
  };
}

function body(request: { postDataJSON(): unknown }): CapturedBody {
  return request.postDataJSON() as CapturedBody;
}

async function json(route: Route, responseBody: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(responseBody) });
}

async function eventStream(route: Route): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
}
