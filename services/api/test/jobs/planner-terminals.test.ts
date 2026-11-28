import { withJobDispatchLock } from '@ogm/builder';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';

import { createPlannerTerminals } from '../../src/jobs/planner-terminals.js';
import { finishRun } from '../../src/builds/publish.js';
import { insertJob, worked } from '../budget/fixture.js';

it('serializes cancellation with child dispatch and replays a persisted terminal projection', async () => {
  const deps = worked();
  insertJob(deps, { id: 'j_parent', kind: 'new_game', state: 'running' });
  const finish = vi.fn((id: string, state: 'done' | 'failed' | 'cancelled') => {
    deps.db.update(schema.jobs).set({ state }).where(eq(schema.jobs.id, id)).run();
  });
  const terminal = createPlannerTerminals(deps.db, finish, () => undefined);
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const dispatch = withJobDispatchLock('j_parent', async () => {
    entered();
    await held;
  });
  await ready;
  const pending = terminal.apply('j_parent', 'cancelled');
  expect(finish).not.toHaveBeenCalled();
  release();
  await Promise.all([dispatch, pending]);
  expect(finish).toHaveBeenCalledWith('j_parent', 'cancelled');
  deps.db.update(schema.jobs).set({ state: 'running' }).where(eq(schema.jobs.id, 'j_parent')).run();
  deps.db
    .insert(schema.jobProjections)
    .values({
      jobId: 'j_parent',
      daemonSlug: 'game',
      ticket: '42',
      stage: 'working',
      stageText: 'Working',
      lifecycle: 'cancelled',
      updatedAt: new Date().toISOString(),
    })
    .run();
  await terminal.reconcile();
  expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_parent')).get()?.state).toBe('cancelled');
  deps.sqlite.close();
});

it('reconciles a completed planner that paused while finishing', async () => {
  const deps = worked();
  insertJob(deps, { id: 'j_paused', kind: 'new_game', state: 'paused_budget' });
  deps.db
    .insert(schema.jobTickets)
    .values({
      jobId: 'j_paused',
      key: 'new-game-plan',
      issueNumber: 42,
      repo: 'owner/game',
      sig: 'planner',
    })
    .run();
  deps.db
    .insert(schema.jobProjections)
    .values({
      jobId: 'j_paused',
      daemonSlug: 'game',
      ticket: '42',
      stage: 'working',
      stageText: 'Working',
      lifecycle: 'completed',
      updatedAt: new Date().toISOString(),
    })
    .run();
  const log = vi.fn();
  const terminal = createPlannerTerminals(deps.db, (id, state) => finishRun(deps, id, state), log);
  await terminal.reconcile();
  expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_paused')).get()?.state).toBe('done');
  expect(log).not.toHaveBeenCalled();
  deps.sqlite.close();
});
