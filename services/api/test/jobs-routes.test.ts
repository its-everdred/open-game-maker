import type { AiurClient } from '@ogm/aiur-client';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { asUser, installUsers, makeApp, makeDeps } from './helpers.js';

const ids = {
  family: 'f_50000000-0000-4000-8000-000000000001',
  user: 'u_50000000-0000-4000-8000-000000000001',
  game: 'g_50000000-0000-4000-8000-000000000001',
  otherGame: 'g_50000000-0000-4000-8000-000000000002',
};

const plan = {
  title: 'Goblin camp',
  summary: 'Add the camp',
  scope: { included: ['camp'], excluded: [] },
  targetControls: ['enemy.color'],
  tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['loads'] }],
};

function setup(platformRole: 'admin' | 'none' = 'none') {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.user, createdAt: '2026-11-01T16:00:00.000Z' })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values({
      familyId: ids.family,
      userId: ids.user,
      role: 'owner',
      capability: 'creator',
      joinedAt: '2026-11-01T16:00:00.000Z',
    })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.user,
      title: 'Game',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: '2026-11-01T16:00:00.000Z',
    })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.user,
      familyId: ids.family,
      platformRole,
      capability: 'creator',
      email: 'creator@example.test',
    },
  ]);
  return deps;
}

async function createJob(app: Awaited<ReturnType<typeof makeApp>>['app'], overrides: Record<string, unknown> = {}) {
  return app.request('/api/v1/jobs', {
    method: 'POST',
    headers: { ...asUser(ids.user), 'content-type': 'application/json' },
    body: JSON.stringify({
      gameId: ids.game,
      branchId: 'main',
      kind: 'feature',
      complexity: 1,
      plan,
      start: 'now',
      ...overrides,
    }),
  });
}

describe('jobs routes', () => {
  it('only exposes development jobs to editors, and hides delisted games across families', async () => {
    const deps = setup();
    const guest = {
      kind: 'user' as const,
      userId: 'guest',
      familyId: 'other',
      platformRole: 'none' as const,
      capability: 'creator' as const,
      email: 'guest@example.test',
    };
    installUsers(deps, [guest]);
    const now = new Date();
    deps.db
      .insert(schema.user)
      .values({
        id: guest.userId,
        email: guest.email,
        name: 'Guest',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    deps.db
      .insert(schema.gameAccess)
      .values({
        gameId: ids.game,
        email: guest.email,
        access: 'play',
        updatedBy: ids.user,
        updatedAt: now.toISOString(),
      })
      .run();
    const { app } = await makeApp(deps);
    const created = await createJob(app);
    expect(created.status).toBe(202);
    const { jobId } = (await created.json()) as { jobId: string };
    const headers = asUser(guest.userId);
    expect((await app.request(`/api/v1/jobs?gameId=${ids.game}`, { headers })).status).toBe(403);
    expect((await app.request(`/api/v1/jobs/${jobId}`, { headers })).status).toBe(403);
    const active = await app.request('/api/v1/jobs?state=active', { headers });
    expect(((await active.json()) as { jobs: unknown[] }).jobs).toEqual([]);
    deps.db.update(schema.gameAccess).set({ access: 'edit' }).where(eq(schema.gameAccess.email, guest.email)).run();
    expect((await app.request(`/api/v1/jobs/${jobId}`, { headers })).status).toBe(200);
    deps.db.update(schema.games).set({ delistedAt: now.toISOString() }).where(eq(schema.games.id, ids.game)).run();
    expect((await app.request(`/api/v1/jobs/${jobId}`, { headers })).status).toBe(404);
  });

  it('enforces the configured daily New Game limit through the public route', async () => {
    const deps = setup();
    deps.config.testerNewGamesPerDay = 1;
    deps.db
      .insert(schema.games)
      .values({
        id: ids.otherGame,
        familyId: ids.family,
        ownerId: ids.user,
        title: 'Other',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: '2020-01-01T00:00:00.000Z',
      })
      .run();
    const { app } = await makeApp(deps);
    expect((await createJob(app, { kind: 'new_game' })).status).toBe(202);
    const refused = await createJob(app, { kind: 'new_game', gameId: ids.otherGame });
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: 'energy_limit_reached', window: 'day' });
  });

  it('rejects arbitrary scope jobs on the public job route', async () => {
    const { app } = await makeApp(setup());
    const response = await createJob(app, { kind: 'scope' });
    expect(response.status).toBe(403);
  });

  it("serves the web app's game and active jobs query strings", async () => {
    const deps = setup();
    deps.db
      .insert(schema.allowances)
      .values({ familyId: ids.family, userId: ids.user, dailyMicroUsd: 20_000_000 })
      .run();
    const { app } = await makeApp(deps);

    const created = await createJob(app);
    expect(created.status).toBe(202);
    const { jobId } = (await created.json()) as { jobId: string };
    deps.db
      .insert(schema.jobProjections)
      .values({
        jobId,
        daemonSlug: 'owner-game',
        ticket: '142',
        stage: 'building',
        stageText: 'Building',
        phase: 'work',
        progressPercent: 40,
        reasonLabels: '[]',
        updatedAt: '2026-11-01T16:00:00.000Z',
      })
      .run();
    deps.db
      .insert(schema.commands)
      .values([
        {
          decisionId: 'decision-open-1',
          jobId,
          daemonSlug: 'owner-game',
          version: 1,
          question: 'Which gate?',
          options: '[]',
          recommend: null,
          status: 'open',
          openedAt: '2026-11-01T16:00:00.000Z',
          answeredAt: null,
        },
        {
          decisionId: 'decision-open-2',
          jobId,
          daemonSlug: 'owner-game',
          version: 1,
          question: 'Which moon?',
          options: '[]',
          recommend: null,
          status: 'open',
          openedAt: '2026-11-01T16:01:00.000Z',
          answeredAt: null,
        },
        {
          decisionId: 'decision-answered',
          jobId,
          daemonSlug: 'owner-game',
          version: 1,
          question: 'Which path?',
          options: '[]',
          recommend: null,
          status: 'answered',
          openedAt: '2026-11-01T15:00:00.000Z',
          answeredAt: '2026-11-01T15:01:00.000Z',
        },
      ])
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: ids.otherGame,
        familyId: ids.family,
        ownerId: ids.user,
        title: 'Other game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: '2026-11-01T16:00:00.000Z',
      })
      .run();
    const otherCreated = await createJob(app, { gameId: ids.otherGame });
    expect(otherCreated.status).toBe(202);
    const { jobId: otherJobId } = (await otherCreated.json()) as { jobId: string };

    const byGame = await app.request(`/api/v1/jobs?gameId=${ids.game}`, { headers: asUser(ids.user) });
    expect(byGame.status).toBe(200);
    expect(await byGame.json()).toMatchObject({
      jobs: [{ id: jobId, stage: 'building', phase: 'work', openRequestCount: 2 }],
    });

    const active = await app.request('/api/v1/jobs?state=active', { headers: asUser(ids.user) });
    expect(active.status).toBe(200);
    const activeBody = (await active.json()) as { jobs: { id: string }[] };
    expect(activeBody.jobs.map(({ id }) => id).sort()).toEqual([jobId, otherJobId].sort());
    expect(activeBody.jobs).toContainEqual(
      expect.objectContaining({ id: jobId, stage: 'building', phase: 'work', openRequestCount: 2 }),
    );

    const read = await app.request(`/api/v1/jobs/${jobId}`, { headers: asUser(ids.user) });
    expect(await read.json()).toMatchObject({
      id: jobId,
      plan: { targetControls: ['enemy.color'] },
      stageText: 'Building',
      progressPercent: 40,
      openRequestCount: 2,
    });

    deps.db.update(schema.jobs).set({ state: 'done' }).where(eq(schema.jobs.id, jobId)).run();
    const afterCompletion = await app.request('/api/v1/jobs?state=active', { headers: asUser(ids.user) });
    expect(afterCompletion.status).toBe(200);
    expect(await afterCompletion.json()).toMatchObject({ jobs: [{ id: otherJobId }] });
  });

  it('returns no active jobs when the user has no visible games', async () => {
    const deps = setup();
    deps.db.delete(schema.games).where(eq(schema.games.id, ids.game)).run();
    const { app } = await makeApp(deps);

    const response = await app.request('/api/v1/jobs?state=active', { headers: asUser(ids.user) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobs: [] });
  });

  it('returns the allowance refusal body at the top level', async () => {
    const deps = setup();
    deps.db
      .insert(schema.allowances)
      .values({ familyId: ids.family, userId: ids.user, dailyMicroUsd: 5_000_000 })
      .run();
    const { app } = await makeApp(deps);
    const response = await createJob(app, { complexity: 3 });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: 'allowance_exceeded',
      remainingMicroUsd: 5_000_000,
      offers: ['trim', 'split', 'queue', 'ask_admin'],
    });
  });

  it('edits and cancels only a queued job, releasing its reservation', async () => {
    const deps = setup();
    deps.db
      .insert(schema.allowances)
      .values({ familyId: ids.family, userId: ids.user, dailyMicroUsd: 20_000_000 })
      .run();
    const { app } = await makeApp(deps);
    const created = await createJob(app, { start: 'at_reset' });
    const { jobId } = (await created.json()) as { jobId: string };
    const nextPlan = { ...plan, title: 'Changed camp' };

    const patched = await app.request(`/api/v1/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ plan: nextPlan }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ plan: { title: 'Changed camp' } });

    const cancelled = await app.request(`/api/v1/jobs/${jobId}/cancel`, {
      method: 'POST',
      headers: asUser(ids.user),
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ state: 'cancelled' });
    expect(
      deps.db
        .select()
        .from(schema.budgetLedger)
        .all()
        .map(({ kind }) => kind),
    ).toEqual(['reservation', 'release']);
  });

  it('does not edit a queued planner child after its issue has been staged', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = await createJob(app, { start: 'at_reset' });
    const { jobId } = (await created.json()) as { jobId: string };
    deps.db
      .update(schema.jobs)
      .set({ idempotencyKey: 'planner:j_parent:starter', aiurIssueNumber: 42 })
      .where(eq(schema.jobs.id, jobId))
      .run();
    const response = await app.request(`/api/v1/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ plan: { ...plan, title: 'Changed' } }),
    });
    expect(response.status).toBe(409);
    expect(JSON.parse(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get()!.plan).title).toBe(
      plan.title,
    );
  });

  it('lets an admin raise a filed job cap through its daemon', async () => {
    const deps = setup('admin');
    deps.db
      .insert(schema.allowances)
      .values({ familyId: ids.family, userId: ids.user, dailyMicroUsd: 20_000_000 })
      .run();
    const setSpendCap = vi.fn().mockResolvedValue({ amount: '2.000000', currency: 'USD' });
    deps.aiurClientForGame = async () => ({ setSpendCap }) as unknown as AiurClient;
    const { app } = await makeApp(deps);
    const created = await createJob(app);
    const { jobId } = (await created.json()) as { jobId: string };
    deps.db
      .update(schema.jobs)
      .set({
        state: 'paused_budget',
        pausedReason: 'budget_exhausted',
        aiurRepo: 'owner/game',
        aiurIssueNumber: 142,
        aiurSpendCapMicroUsd: 1_500_000,
      })
      .where(eq(schema.jobs.id, jobId))
      .run();

    const response = await app.request(`/api/v1/jobs/${jobId}/raise-cap`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ amountMicroUsd: 2_000_000 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'running', hardCapMicroUsd: 2_000_000 });
    expect(setSpendCap).toHaveBeenCalledWith('142', '2.000000');
  });
});
