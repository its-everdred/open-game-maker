import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import type { AppDeps } from '../src/app/types.js';
import { seededApp, X, Y } from './admin-fixture.js';

const PROMPT = 'make the dragon breathe secret fire';
const PRIVATE_GAME = 'g-x-private';
const DELISTED_GAME = 'g-x-delisted';

function game(deps: AppDeps, id: string, visibility: 'listed' | 'private', delistedAt: string | null = null) {
  deps.db
    .insert(schema.games)
    .values({
      id,
      familyId: X.family,
      ownerId: X.creator.userId,
      title: id,
      visibility,
      repoVisibility: 'private',
      createdAt: '2026-11-01T00:00:00.000Z',
      delistedAt,
    })
    .run();
}

function job(deps: AppDeps, id: string, gameId: string, familyId: string, creatorId: string, createdAt: string) {
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId,
      branchId: 'main',
      familyId,
      creatorId,
      kind: 'feature',
      complexity: 2,
      state: 'running',
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify({ title: PROMPT, summary: PROMPT }),
      reservation: '{}',
      hardCapMicroUsd: 500_000,
      usageMicroUsd: 12_000,
      idempotencyKey: `key-${id}`,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
}

function rework(deps: AppDeps, jobId: string, at: string) {
  deps.db
    .insert(schema.aiurPhaseEvents)
    .values({ jobId, phase: 'work', transition: 'rework', at, source: 'events_feed' })
    .run();
}

async function seeded() {
  const seed = await seededApp();
  const { deps } = seed;
  game(deps, PRIVATE_GAME, 'private');
  game(deps, DELISTED_GAME, 'listed', '2026-11-01T06:00:00.000Z');
  job(deps, 'j-old', X.game, X.family, X.creator.userId, '2026-11-01T01:00:00.000Z');
  job(deps, 'j-private', PRIVATE_GAME, X.family, X.creator.userId, '2026-11-01T03:00:00.000Z');
  job(deps, 'j-delisted', DELISTED_GAME, X.family, X.creator.userId, '2026-11-01T02:00:00.000Z');
  job(deps, 'j-y', Y.game, Y.family, Y.admin.userId, '2026-11-01T04:00:00.000Z');
  rework(deps, 'j-private', '2026-11-01T03:10:00.000Z');
  rework(deps, 'j-private', '2026-11-01T03:20:00.000Z');
  deps.db
    .insert(schema.aiurPhaseEvents)
    .values({
      jobId: 'j-private',
      phase: 'work',
      transition: null,
      at: '2026-11-01T03:05:00.000Z',
      source: 'events_feed',
    })
    .run();
  rework(deps, 'j-y', '2026-11-01T04:10:00.000Z');
  deps.db
    .insert(schema.jobProjections)
    .values({
      jobId: 'j-private',
      daemonSlug: 'd-x',
      ticket: '7',
      stage: 'fixing',
      stageText: 'Fixing a problem',
      updatedAt: '2026-11-01T03:20:00.000Z',
    })
    .run();
  // Same creation time: the later insert is the newer build.
  job(deps, 'j-tie-first', X.game, X.family, X.creator.userId, '2026-11-01T00:30:00.000Z');
  job(deps, 'j-tie-second', X.game, X.family, X.creator.userId, '2026-11-01T00:30:00.000Z');
  // A job row claiming family X on family Y's game must not surface to either family.
  job(deps, 'j-mismatch', Y.game, X.family, X.creator.userId, '2026-11-01T05:00:00.000Z');
  return seed;
}

describe('GET /api/v1/admin/builds', () => {
  it("lists another member's private-game build to an admin", async () => {
    const { call } = await seeded();
    const res = await call(X.admin, 'GET', '/builds');
    expect(res.status).toBe(200);
    const { builds } = (await res.json()) as { builds: { job: { id: string } }[] };
    expect(builds.find((build) => build.job.id === 'j-private')).toEqual({
      job: {
        id: 'j-private',
        kind: 'feature',
        state: 'running',
        pausedReason: null,
        stage: 'fixing',
        stageText: 'Fixing a problem',
        usageMicroUsd: 12_000,
        hardCapMicroUsd: 500_000,
        createdAt: '2026-11-01T03:00:00.000Z',
        updatedAt: '2026-11-01T03:00:00.000Z',
        terminalAt: null,
      },
      game: {
        id: PRIVATE_GAME,
        title: PRIVATE_GAME,
        ownerId: X.creator.userId,
        visibility: 'private',
        delistedAt: null,
      },
      member: { userId: X.creator.userId, email: X.creator.email },
      retries: 2,
    });
  });

  it('returns all families newest first, delisted games included, with per-build retries', async () => {
    const { call } = await seeded();
    const { builds } = (await (await call(X.owner, 'GET', '/builds')).json()) as {
      builds: { job: { id: string; stage: string | null }; retries: number }[];
    };
    expect(builds.find((build) => build.job.id === 'j-old')?.job.stage).toBeNull();
    expect(builds.map((build) => [build.job.id, build.retries])).toEqual([
      ['j-y', 1],
      ['j-private', 2],
      ['j-delisted', 0],
      ['j-old', 0],
      ['j-tie-second', 0],
      ['j-tie-first', 0],
    ]);
  });

  it('lets an admin see builds across families without mismatched rows', async () => {
    const { call } = await seeded();
    const { builds } = (await (await call(Y.admin, 'GET', '/builds')).json()) as {
      builds: { job: { id: string }; retries: number }[];
    };
    expect(builds.map((build) => [build.job.id, build.retries])).toEqual([
      ['j-y', 1],
      ['j-private', 2],
      ['j-delisted', 0],
      ['j-old', 0],
      ['j-tie-second', 0],
      ['j-tie-first', 0],
    ]);
  });

  it('ignores a caller-supplied family id', async () => {
    const { call } = await seeded();
    const res = await call(Y.admin, 'GET', `/builds?familyId=${X.family}`);
    const { builds } = (await res.json()) as { builds: { job: { id: string } }[] };
    expect(builds.map((build) => build.job.id)).toContain('j-private');
    expect(builds.map((build) => build.job.id)).toContain('j-y');
  });

  it('keeps prompt text and the plan out of the response', async () => {
    const { call } = await seeded();
    const text = await (await call(X.admin, 'GET', '/builds')).text();
    expect(text).not.toContain(PROMPT);
    expect(text).not.toContain('"plan"');
  });

  it('refuses a member who is not an admin', async () => {
    const { call } = await seeded();
    const res = await call(X.creator, 'GET', '/builds');
    expect(res.status).toBe(403);
  });
});
