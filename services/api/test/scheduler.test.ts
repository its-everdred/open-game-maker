import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { tick } from '../src/jobs/scheduler.js';
import { makeDeps } from './helpers.js';

const BEFORE = new Date('2026-11-02T07:59:59.000Z');
const RESET = new Date('2026-11-02T08:00:00.000Z');
const defaults = { dailyAllowanceMicroUsd: 20_000_000, resetZone: 'America/Los_Angeles' };

function setup() {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: BEFORE.toISOString() })
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
      createdAt: BEFORE.toISOString(),
    })
    .run();
  const started: string[] = [];
  const changed: string[] = [];
  deps.events.on('job.started', ({ jobId }) => started.push(jobId));
  deps.events.on('job.changed', ({ jobId }) => changed.push(jobId));
  return { deps, started, changed };
}

function queued(deps: ReturnType<typeof makeDeps>, id: string, createdAt: string, start: 'now' | 'at_reset' = 'now') {
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId: 'g_1',
      branchId: 'main',
      familyId: 'f_1',
      creatorId: 'u_1',
      kind: 'feature',
      complexity: 1,
      state: 'queued',
      start,
      startAt: start === 'at_reset' ? RESET.toISOString() : null,
      slot: 'edit',
      plan: JSON.stringify({
        title: 'Feature',
        summary: 'Build it',
        scope: { included: ['feature'], excluded: [] },
        tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['works'] }],
      }),
      reservation: '{"amountMicroUsd":500000,"sizeClass":"small","confidence":"low"}',
      hardCapMicroUsd: 500_000,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
}

describe('job scheduler', () => {
  it('waits for the planner to merge before starting its child', () => {
    const { deps } = setup();
    queued(deps, 'j_parent', BEFORE.toISOString());
    deps.db
      .update(schema.jobs)
      .set({ kind: 'new_game', slot: 'new_game', state: 'running' })
      .where(eq(schema.jobs.id, 'j_parent'))
      .run();
    queued(deps, 'j_child', BEFORE.toISOString());
    deps.db
      .update(schema.jobs)
      .set({ idempotencyKey: 'planner:j_parent:starter' })
      .where(eq(schema.jobs.id, 'j_child'))
      .run();
    const input = { db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults };
    expect(tick(input, RESET)).toEqual([]);
    deps.db.update(schema.jobs).set({ state: 'done' }).where(eq(schema.jobs.id, 'j_parent')).run();
    expect(tick(input, RESET)).toEqual([]);
    deps.db
      .update(schema.jobs)
      .set({ aiurIssueNumber: 42, aiurRepo: 'owner/game' })
      .where(eq(schema.jobs.id, 'j_child'))
      .run();
    expect(tick(input, RESET)).toEqual(['j_child']);
    expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_child')).get()?.state).toBe('admitted');
  });

  it('keeps a waiting child out of dispatch if the planner fails', () => {
    const { deps } = setup();
    queued(deps, 'j_parent', BEFORE.toISOString());
    deps.db
      .update(schema.jobs)
      .set({ kind: 'new_game', slot: 'new_game', state: 'failed' })
      .where(eq(schema.jobs.id, 'j_parent'))
      .run();
    queued(deps, 'j_child', BEFORE.toISOString());
    deps.db
      .update(schema.jobs)
      .set({ idempotencyKey: 'planner:j_parent:starter' })
      .where(eq(schema.jobs.id, 'j_child'))
      .run();
    expect(tick({ db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults }, RESET)).toEqual([]);
    const child = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_child')).get()!;
    expect(child.state).toBe('queued');
    expect(child.releasedAt).toBeNull();
  });

  it('starts an at-reset job exactly when the family reset arrives', () => {
    const { deps, started, changed } = setup();
    queued(deps, 'j_reset', BEFORE.toISOString(), 'at_reset');

    expect(tick({ db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults }, BEFORE)).toEqual([]);
    expect(tick({ db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults }, RESET)).toEqual(['j_reset']);
    expect(tick({ db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults }, RESET)).toEqual([]);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('admitted');
    expect(started).toEqual(['j_reset']);
    expect(changed).toEqual(['j_reset']);
  });

  it('takes the oldest queued edit when only one slot is free', () => {
    const { deps, started } = setup();
    deps.db
      .insert(schema.familyBudgetSettings)
      .values({
        familyId: 'f_1',
        resetZone: defaults.resetZone,
        unitLabel: 'energy',
        microUsdPerUnit: 100_000,
        platformCapMicroUsd: 50_000_000,
        slotsNewGame: 1,
        slotsEdit: 1,
        hardCapMultiplier: 1,
      })
      .run();
    queued(deps, 'j_old', '2026-11-01T00:00:00.000Z');
    queued(deps, 'j_new', '2026-11-01T01:00:00.000Z');

    expect(tick({ db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults }, RESET)).toEqual(['j_old']);
    expect(started).toEqual(['j_old']);
    expect(
      deps.db
        .select()
        .from(schema.jobs)
        .all()
        .map(({ id, state }) => [id, state]),
    ).toEqual([
      ['j_old', 'admitted'],
      ['j_new', 'queued'],
    ]);
  });

  it('promotes queued work after an active job releases its slot', () => {
    const { deps } = setup();
    deps.db
      .insert(schema.familyBudgetSettings)
      .values({
        familyId: 'f_1',
        resetZone: defaults.resetZone,
        unitLabel: 'energy',
        microUsdPerUnit: 100_000,
        platformCapMicroUsd: 50_000_000,
        slotsNewGame: 1,
        slotsEdit: 1,
        hardCapMultiplier: 1,
      })
      .run();
    queued(deps, 'j_released', '2026-11-01T00:00:00.000Z');
    deps.db
      .update(schema.jobs)
      .set({ state: 'running', releasedAt: RESET.toISOString() })
      .where(eq(schema.jobs.id, 'j_released'))
      .run();
    queued(deps, 'j_waiting', '2026-11-01T01:00:00.000Z');

    expect(tick({ db: deps.db, sqlite: deps.sqlite, events: deps.events, defaults }, RESET)).toEqual(['j_waiting']);
  });
});
