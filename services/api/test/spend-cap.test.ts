import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { reserve } from '../src/budget/ledger.js';
import { markFiled, markPaused, markRunning, markTerminal, raiseCap, toUsdString } from '../src/jobs/spend-cap.js';
import { makeDeps } from './helpers.js';

const NOW = new Date('2026-11-01T16:00:00.000Z');
const defaults = { dailyAllowanceMicroUsd: 20_000_000, resetZone: 'America/Los_Angeles' };

function seed(state: 'admitted' | 'filed' | 'running' | 'paused_budget' = 'admitted') {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: NOW.toISOString() })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: 'g_1',
      familyId: 'f_1',
      ownerId: 'u_1',
      title: 'Game',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: NOW.toISOString(),
    })
    .run();
  deps.db
    .insert(schema.jobs)
    .values({
      id: 'j_1',
      gameId: 'g_1',
      branchId: 'main',
      familyId: 'f_1',
      creatorId: 'u_1',
      kind: 'feature',
      complexity: 3,
      state,
      pausedReason: state === 'paused_budget' ? 'budget_exhausted' : null,
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify({
        title: 'Feature',
        summary: 'Build it',
        scope: { included: ['feature'], excluded: [] },
        tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['works'] }],
      }),
      reservation: '{"amountMicroUsd":4000000,"sizeClass":"large","confidence":"low"}',
      hardCapMicroUsd: 9_000_000,
      usageMicroUsd: 2_500_000,
      aiurRepo: state === 'admitted' ? null : 'owner/game',
      aiurIssueNumber: state === 'admitted' ? null : 142,
      aiurSpendCapMicroUsd: state === 'admitted' ? null : 9_000_000,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run();
  const changed: string[] = [];
  deps.events.on('job.changed', ({ state: next }) => changed.push(next));
  return { deps, changed };
}

const lifecycleDeps = (deps: ReturnType<typeof makeDeps>) => ({
  db: deps.db,
  sqlite: deps.sqlite,
  events: deps.events,
  defaults,
  now: () => NOW,
});

describe('job spend cap and lifecycle', () => {
  it('records completion when a budget-paused worker finishes', () => {
    const { deps, changed } = seed('paused_budget');
    markTerminal(lifecycleDeps(deps), 'j_1', 'done', { deferRelease: true });
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('done');
    expect(changed).toEqual(['done']);
  });
  it('formats integer micro-dollars without float ambiguity', () => {
    expect(toUsdString(9_000_000)).toBe('9.000000');
    expect(toUsdString(1)).toBe('0.000001');
  });

  it('sets the aiur spend cap before marking a filed job', async () => {
    const { deps, changed } = seed();
    const setSpendCap = vi.fn().mockResolvedValue({ amount: '9.000000', currency: 'USD' });
    await markFiled(lifecycleDeps(deps), 'j_1', { repo: 'owner/game', issueNumber: 142 }, { setSpendCap });

    expect(setSpendCap).toHaveBeenCalledWith('142', '9.000000');
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({
      state: 'filed',
      aiurRepo: 'owner/game',
      aiurIssueNumber: 142,
      aiurSpendCapMicroUsd: 9_000_000,
    });
    expect(changed).toEqual(['filed']);
  });

  it('fails closed while retaining the filed ticket identity', async () => {
    const { deps, changed } = seed();
    const setSpendCap = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(
      markFiled(lifecycleDeps(deps), 'j_1', { repo: 'owner/game', issueNumber: 142 }, { setSpendCap }),
    ).rejects.toMatchObject({ status: 502, code: 'spend_cap_failed' });
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({
      state: 'admitted',
      aiurRepo: 'owner/game',
      aiurIssueNumber: 142,
      aiurSpendCapMicroUsd: null,
    });
    expect(changed).toEqual([]);
  });

  it('runs, pauses, resumes through a cap raise, and records the adjustment', async () => {
    const { deps, changed } = seed('filed');
    markRunning(lifecycleDeps(deps), 'j_1');
    markPaused(lifecycleDeps(deps), 'j_1', 'budget_exhausted');
    const setSpendCap = vi.fn().mockResolvedValue({ amount: '12.000000', currency: 'USD' });
    await raiseCap(lifecycleDeps(deps), 'j_1', 12_000_000, { setSpendCap });

    expect(setSpendCap).toHaveBeenCalledWith('142', '12.000000');
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({
      state: 'running',
      pausedReason: null,
      hardCapMicroUsd: 12_000_000,
      aiurSpendCapMicroUsd: 12_000_000,
    });
    expect(deps.db.select().from(schema.budgetLedger).all()).toEqual([
      expect.objectContaining({ kind: 'adjustment', amountMicroUsd: 3_000_000 }),
    ]);
    expect(changed).toEqual(['running', 'paused_budget', 'running']);
  });

  it('reclaims a released slot before continuing an out-of-budget job', async () => {
    const { deps } = seed('paused_budget');
    deps.db
      .update(schema.jobs)
      .set({ releasedAt: NOW.toISOString(), usageMicroUsd: 4_000_000 })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    const setSpendCap = vi.fn().mockResolvedValue({ amount: '12.000000', currency: 'USD' });

    await raiseCap(lifecycleDeps(deps), 'j_1', 12_000_000, { setSpendCap });

    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({
      state: 'running',
      releasedAt: null,
      hardCapMicroUsd: 12_000_000,
    });
  });

  it('leaves a released job paused when no slot is available', async () => {
    const { deps } = seed('paused_budget');
    deps.db.update(schema.jobs).set({ releasedAt: NOW.toISOString() }).where(eq(schema.jobs.id, 'j_1')).run();
    deps.db
      .insert(schema.familyBudgetSettings)
      .values({
        familyId: 'f_1',
        resetZone: defaults.resetZone,
        unitLabel: 'energy',
        microUsdPerUnit: 100_000,
        platformCapMicroUsd: 20_000_000,
        slotsNewGame: 1,
        slotsEdit: 0,
        hardCapMultiplier: 1,
      })
      .run();
    const setSpendCap = vi.fn();

    await expect(raiseCap(lifecycleDeps(deps), 'j_1', 12_000_000, { setSpendCap })).rejects.toMatchObject({
      status: 409,
      code: 'slot_unavailable',
    });
    expect(setSpendCap).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({
      state: 'paused_budget',
      releasedAt: NOW.toISOString(),
    });
  });

  it('restores a released slot claim when the upstream cap raise fails', async () => {
    const { deps } = seed('paused_budget');
    deps.db.update(schema.jobs).set({ releasedAt: NOW.toISOString() }).where(eq(schema.jobs.id, 'j_1')).run();
    const setSpendCap = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(raiseCap(lifecycleDeps(deps), 'j_1', 12_000_000, { setSpendCap })).rejects.toMatchObject({
      status: 502,
      code: 'spend_cap_failed',
    });
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({
      state: 'paused_budget',
      releasedAt: NOW.toISOString(),
      hardCapMicroUsd: 9_000_000,
    });
  });

  it('serializes concurrent cap raises against the latest stored cap', async () => {
    const { deps } = seed('running');
    const setSpendCap = vi.fn(async () => {
      await Promise.resolve();
      return { amount: '15.000000', currency: 'USD' as const };
    });

    await Promise.all([
      raiseCap(lifecycleDeps(deps), 'j_1', 12_000_000, { setSpendCap }),
      raiseCap(lifecycleDeps(deps), 'j_1', 15_000_000, { setSpendCap }),
    ]);

    expect(
      deps.db
        .select()
        .from(schema.budgetLedger)
        .all()
        .filter(({ kind }) => kind === 'adjustment')
        .map(({ amountMicroUsd }) => amountMicroUsd),
    ).toEqual([3_000_000, 3_000_000]);
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({
      hardCapMicroUsd: 15_000_000,
      aiurSpendCapMicroUsd: 15_000_000,
    });
  });

  it('rejects cap raises before filing and after termination', async () => {
    const { deps } = seed();
    deps.db
      .update(schema.jobs)
      .set({ aiurRepo: 'owner/game', aiurIssueNumber: 142 })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    const setSpendCap = vi.fn();

    await expect(raiseCap(lifecycleDeps(deps), 'j_1', 12_000_000, { setSpendCap })).rejects.toMatchObject({
      status: 409,
      code: 'job_not_active',
    });
    deps.db.update(schema.jobs).set({ state: 'done' }).where(eq(schema.jobs.id, 'j_1')).run();
    await expect(raiseCap(lifecycleDeps(deps), 'j_1', 12_000_000, { setSpendCap })).rejects.toMatchObject({
      status: 409,
      code: 'job_not_active',
    });
    expect(setSpendCap).not.toHaveBeenCalled();
  });

  it('releases unused reservation once on a terminal transition', () => {
    const { deps, changed } = seed('running');
    reserve({ db: deps.db, jobId: 'j_1', amountMicroUsd: 4_000_000, at: NOW, zone: defaults.resetZone });
    markTerminal(lifecycleDeps(deps), 'j_1', 'failed');
    markTerminal(lifecycleDeps(deps), 'j_1', 'failed');

    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({ state: 'failed', terminalAt: NOW.toISOString() });
    expect(
      deps.db
        .select()
        .from(schema.budgetLedger)
        .all()
        .filter(({ kind }) => kind === 'release'),
    ).toEqual([expect.objectContaining({ kind: 'release', amountMicroUsd: 1_500_000 })]);
    expect(changed).toEqual(['failed']);
  });
});
