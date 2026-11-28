import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { admitPlannerChild, plannerChildStatus } from '../../src/previews/planner-child.js';
import { weeklyJobs } from '../../src/budget/weekly-jobs.js';
import { ids, insertJob, plan, worked } from '../budget/fixture.js';

const parentId = 'j_planner';
const BASE = { branch: 'aiur/42', sha: 'a'.repeat(40) };
const child = { key: 'starter', role: 'role:gameplay', decisions: ['D-01'], complexity: 2, plan };

describe('planner child admission', () => {
  it('reserves a normal budget, enforces the per-game cap and recovers a retry', async () => {
    const deps = worked();
    insertJob(deps, {
      id: parentId,
      kind: 'new_game',
      state: 'running',
      aiurIssueNumber: 42,
      plan: JSON.stringify({ ...plan, _plannerTicketLimit: 1 }),
    });
    // A later configuration change must not expand this plan's bound.
    deps.config.plannerTicketLimit = 5;
    insertJob(deps, { id: 'j_edit_2' });
    insertJob(deps, { id: 'j_edit_3' });
    const first = await admitPlannerChild(deps, parentId, child, BASE);
    expect(first.reservation.amountMicroUsd).toBeGreaterThan(0);
    // All three edit slots are already held.
    expect(first.state).toBe('queued');
    expect(await admitPlannerChild(deps, parentId, child, BASE)).toMatchObject({ jobId: first.jobId, reused: true });
    expect(await admitPlannerChild(deps, parentId, child, { ...BASE, sha: 'b'.repeat(40) })).toMatchObject({
      jobId: first.jobId,
      reused: true,
    });
    await expect(
      admitPlannerChild(deps, parentId, { ...child, plan: { ...plan, summary: 'Changed' } }, BASE),
    ).rejects.toMatchObject({ code: 'planner_child_conflict' });
    await expect(admitPlannerChild(deps, parentId, { ...child, complexity: 3 }, BASE)).rejects.toMatchObject({
      code: 'planner_child_conflict',
    });
    await expect(admitPlannerChild(deps, parentId, { ...child, key: 'extra' }, BASE)).rejects.toMatchObject({
      code: 'planner_ticket_limit',
    });
    expect(plannerChildStatus(deps, parentId, 'starter')).toMatchObject({ jobId: first.jobId, issueNumber: null });
    deps.db
      .insert(schema.jobTickets)
      .values({
        jobId: first.jobId,
        key: 'T1',
        issueNumber: 44,
        repo: 'owner/game',
        sig: 'test',
        todoAt: '2026-11-27T00:00:00.000Z',
      })
      .run();
    deps.db.update(schema.jobs).set({ aiurIssueNumber: 44 }).where(eq(schema.jobs.id, first.jobId)).run();
    expect(plannerChildStatus(deps, parentId, 'starter')).toMatchObject({
      issueNumber: 44,
      todoAt: '2026-11-27T00:00:00.000Z',
    });
    insertJob(deps, {
      id: 'j_other_parent',
      kind: 'new_game',
      state: 'running',
      aiurIssueNumber: 43,
      plan: JSON.stringify({ ...plan, _plannerTicketLimit: 1 }),
    });
    await expect(admitPlannerChild(deps, 'j_other_parent', { ...child, key: 'other' }, BASE)).rejects.toMatchObject({
      code: 'planner_ticket_limit',
    });
    expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, first.jobId)).get()).toMatchObject({
      gameId: ids.game,
      creatorId: ids.creator,
      kind: 'feature',
      idempotencyKey: `planner:${parentId}:starter`,
    });
    deps.sqlite.close();
  });

  it('admits a New Game child when the tester has no edit quota', async () => {
    const deps = worked();
    const date = new Date();
    const user = {
      id: ids.creator,
      name: 'Tester',
      email: 'tester@example.test',
      emailVerified: true,
      createdAt: date,
      updatedAt: date,
    };
    deps.db.insert(schema.user).values(user).run();
    deps.db
      .insert(schema.allowedUsers)
      .values({ email: user.email, role: 'maker', addedBy: 'env', addedAt: date.toISOString() })
      .run();
    deps.db.insert(schema.weeklyJobBudgets).values({ email: user.email.toLowerCase(), newGames: 2, edits: 0 }).run();
    insertJob(deps, { id: parentId, kind: 'new_game', state: 'running', aiurIssueNumber: 42 });
    const result = await admitPlannerChild(deps, parentId, child, BASE);
    expect(result.jobId).toBeTruthy();
    deps.db
      .update(schema.weeklyJobBudgets)
      .set({ edits: 3 })
      .where(eq(schema.weeklyJobBudgets.email, user.email.toLowerCase()))
      .run();
    expect(weeklyJobs(deps.db, ids.creator, new Date(), deps.config.resetZoneDefault).remaining.edits).toBe(3);
    deps.sqlite.close();
  });

  it('atomically admits only one of two concurrent children at the last slot', async () => {
    const deps = worked();
    insertJob(deps, { id: parentId, kind: 'new_game', state: 'running', aiurIssueNumber: 42 });
    deps.config.plannerTicketLimit = 1;
    const results = await Promise.allSettled([
      admitPlannerChild(deps, parentId, child, BASE),
      admitPlannerChild(deps, parentId, { ...child, key: 'other' }, BASE),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    deps.sqlite.close();
  });

  it('assigns each decision to only one child even when admissions race', async () => {
    const deps = worked();
    insertJob(deps, { id: parentId, kind: 'new_game', state: 'running', aiurIssueNumber: 42 });
    deps.config.plannerTicketLimit = 3;
    const results = await Promise.allSettled([
      admitPlannerChild(deps, parentId, child, BASE),
      admitPlannerChild(deps, parentId, { ...child, key: 'other' }, BASE),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'planner_decision_conflict' },
    });
    deps.sqlite.close();
  });
});
