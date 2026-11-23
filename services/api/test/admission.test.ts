import { describe, expect, it } from 'vitest';

import type { CreateJobRequest } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { AdmissionRefused, admit } from '../src/jobs/admission.js';
import { reserve } from '../src/budget/ledger.js';
import { makeDeps } from './helpers.js';

const NOW = new Date('2026-11-01T16:00:00.000Z');
const ids = {
  family: 'f_00000000-0000-4000-8000-000000000001',
  user: 'u_00000000-0000-4000-8000-000000000002',
  game: 'g_00000000-0000-4000-8000-000000000003',
};
const actor = { userId: ids.user, familyId: ids.family, platformRole: 'none' as const, capability: 'creator' as const };
const defaults = { dailyAllowanceMicroUsd: 11_000_000, resetZone: 'America/Los_Angeles' };

function request(overrides: Partial<CreateJobRequest> = {}): CreateJobRequest {
  return {
    gameId: ids.game,
    branchId: 'main',
    kind: 'feature',
    complexity: 3,
    plan: {
      title: 'Goblin camp',
      summary: 'Add the camp',
      scope: { included: ['camp'], excluded: [] },
      tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['loads'] }],
    },
    start: 'now',
    ...overrides,
  };
}

function harness(input: { daily?: number; platformCap?: number } = {}) {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.user, createdAt: NOW.toISOString() })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values({
      familyId: ids.family,
      userId: ids.user,
      role: 'owner',
      capability: 'creator',
      joinedAt: NOW.toISOString(),
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
      createdAt: NOW.toISOString(),
    })
    .run();
  deps.db
    .insert(schema.allowances)
    .values({ familyId: ids.family, userId: ids.user, dailyMicroUsd: input.daily ?? 11_000_000 })
    .run();
  if (input.platformCap !== undefined) {
    deps.db
      .insert(schema.familyBudgetSettings)
      .values({
        familyId: ids.family,
        resetZone: defaults.resetZone,
        unitLabel: 'energy',
        microUsdPerUnit: 100_000,
        platformCapMicroUsd: input.platformCap,
        slotsNewGame: 1,
        slotsEdit: 3,
        hardCapMultiplier: 1,
      })
      .run();
  }
  const changed: unknown[] = [];
  deps.events.on('job.changed', (event) => changed.push(event));
  return { deps, changed };
}

function insertActive(deps: ReturnType<typeof makeDeps>, id: string, kind: 'new_game' | 'feature' = 'feature') {
  const slot = kind === 'new_game' ? 'new_game' : 'edit';
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId: ids.game,
      branchId: 'main',
      familyId: ids.family,
      creatorId: ids.user,
      kind,
      complexity: 3,
      state: 'running',
      start: 'now',
      slot,
      plan: JSON.stringify(request().plan),
      reservation: JSON.stringify({ amountMicroUsd: 500_000, sizeClass: 'small', confidence: 'low' }),
      hardCapMicroUsd: 500_000,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run();
}

describe('job admission', () => {
  it('returns AE1 allowance refusal now and queues the same work at reset', async () => {
    const { deps } = harness();
    insertActive(deps, 'j_existing');
    reserve({ db: deps.db, jobId: 'j_existing', at: NOW, zone: defaults.resetZone, amountMicroUsd: 9_000_000 });

    await expect(
      admit({ db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults }, request(), actor),
    ).rejects.toMatchObject({
      body: {
        error: 'allowance_exceeded',
        remainingMicroUsd: 2_000_000,
        offers: ['trim', 'split', 'queue', 'ask_admin'],
      },
    } satisfies Partial<AdmissionRefused>);

    await expect(
      admit(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
        request({ start: 'at_reset' }),
        actor,
      ),
    ).resolves.toMatchObject({ state: 'queued', position: 1, reservation: { amountMicroUsd: 9_000_000 } });
  });

  it('queues exhausted slots and counts repair and scope jobs as edits', async () => {
    const { deps } = harness({ daily: 100_000_000 });
    insertActive(deps, 'j_edit_1');
    insertActive(deps, 'j_edit_2');
    insertActive(deps, 'j_edit_3');

    await expect(
      admit(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
        request({ kind: 'repair', idempotencyKey: 'repair' }),
        actor,
      ),
    ).resolves.toMatchObject({
      state: 'queued',
      slot: 'edit',
      position: 1,
      reservation: { amountMicroUsd: 3_000_000 },
    });
    await expect(
      admit(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
        request({ kind: 'scope', complexity: 5, idempotencyKey: 'scope' }),
        actor,
      ),
    ).resolves.toMatchObject({ state: 'queued', slot: 'edit', position: 2, reservation: { sizeClass: 'small' } });
  });

  it('does not count released jobs against slot admission', async () => {
    const { deps } = harness({ daily: 100_000_000 });
    for (const id of ['j_edit_1', 'j_edit_2', 'j_edit_3']) insertActive(deps, id);
    deps.db.update(schema.jobs).set({ releasedAt: NOW.toISOString() }).run();

    await expect(
      admit(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
        request({ complexity: 1 }),
        actor,
      ),
    ).resolves.toMatchObject({ state: 'admitted', slot: 'edit' });
  });

  it('queues a second new-game job', async () => {
    const { deps } = harness({ daily: 100_000_000 });
    insertActive(deps, 'j_new_1', 'new_game');
    await expect(
      admit(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
        request({ kind: 'new_game', complexity: 1 }),
        actor,
      ),
    ).resolves.toMatchObject({ state: 'queued', slot: 'new_game', position: 1, reservation: { sizeClass: 'large' } });
  });

  it('offers only trim and split when work cannot fit after reset', async () => {
    const { deps } = harness({ daily: 5_000_000 });
    await expect(
      admit(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
        request({ start: 'at_reset', complexity: 4 }),
        actor,
      ),
    ).rejects.toMatchObject({
      body: {
        error: 'allowance_exceeded',
        resetsAt: '2026-11-02T08:00:00.000Z',
        offers: ['trim', 'split'],
      },
    });
  });

  it('refuses the platform cap before creating a job', async () => {
    const { deps } = harness({ daily: 100_000_000, platformCap: 8_000_000 });
    await expect(
      admit({ db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults }, request(), actor),
    ).rejects.toMatchObject({ body: { error: 'platform_cap_reached', remainingMicroUsd: 8_000_000 } });
    expect(deps.db.select().from(schema.jobs).all()).toEqual([]);
  });

  it('replays idempotently and emits one change', async () => {
    const { deps, changed } = harness({ daily: 100_000_000 });
    const input = request({ complexity: 1, idempotencyKey: 'voice:session:1' });
    const first = await admit(
      { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
      input,
      actor,
    );
    deps.db.update(schema.jobs).set({ state: 'filed' }).where(eq(schema.jobs.id, first.jobId)).run();
    const second = await admit(
      { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
      input,
      actor,
    );
    expect(second.jobId).toBe(first.jobId);
    expect(second).toMatchObject({ reused: true, samePlan: true });
    const other = await admit(
      { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
      { ...input, plan: { ...input.plan, summary: 'A different request' } },
      actor,
    );
    expect(other).toMatchObject({ jobId: first.jobId, reused: true, samePlan: false });
    expect(second.state).toBe('admitted');
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(1);
    expect(changed).toHaveLength(1);
  });

  // #1270: the edit chat's first message becomes the job, and the composer posts nothing more. Without this row the
  // creator's message never appeared in the chat it was typed into.
  it('opens an edit-chat job’s conversation with the creator’s message, already delivered by the ticket', async () => {
    const { deps } = harness({ daily: 100_000_000 });
    const deps2 = { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults };
    const typed = await admit(deps2, request({ complexity: 1, idempotencyKey: 'voice-edit:g:session' }), actor);
    await admit(deps2, request({ complexity: 1, idempotencyKey: 'voice-edit:g:session' }), actor);
    const other = await admit(deps2, request({ complexity: 1, idempotencyKey: 'voice:session:2' }), actor);

    const rows = deps.db.select().from(schema.buildChatMessages).all();
    expect(rows).toEqual([
      expect.objectContaining({ jobId: typed.jobId, actor: 'creator', kind: 'text', text: 'Add the camp' }),
    ]);
    // `sent`: the mirror never sends it again, so the worker does not get the instruction twice.
    expect(rows[0]?.mirrorState).toBe('sent');
    expect(rows.some((row) => row.jobId === other.jobId)).toBe(false);
  });

  it('rejects a non-main branch', async () => {
    const { deps } = harness();
    await expect(
      admit(
        { db: deps.db, sqlite: deps.sqlite, events: deps.events, now: () => NOW, defaults },
        request({ branchId: 'feature-x' }),
        actor,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'branch_not_main' });
  });
});
