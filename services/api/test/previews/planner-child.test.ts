import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { admitPlannerChild, plannerChildStatus } from '../../src/previews/planner-child.js';
import { weeklyJobs } from '../../src/budget/weekly-jobs.js';
import { ids, insertJob, plan, worked } from '../budget/fixture.js';

const parentId = 'j_planner';
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
    const first = await admitPlannerChild(deps, parentId, child);
    expect(first.reservation.amountMicroUsd).toBeGreaterThan(0);
    // All three edit slots are already held.
    expect(first.state).toBe('queued');
    expect(await admitPlannerChild(deps, parentId, child)).toMatchObject({ jobId: first.jobId, reused: true });
    await expect(
      admitPlannerChild(deps, parentId, { ...child, plan: { ...plan, summary: 'Changed' } }),
    ).rejects.toMatchObject({ code: 'planner_child_conflict' });
    await expect(admitPlannerChild(deps, parentId, { ...child, key: 'extra' })).rejects.toMatchObject({
      code: 'planner_ticket_limit',
    });
    expect(plannerChildStatus(deps, parentId, 'starter')).toMatchObject({ jobId: first.jobId, issueNumber: null });
    insertJob(deps, {
      id: 'j_other_parent',
      kind: 'new_game',
      state: 'running',
      aiurIssueNumber: 43,
      plan: JSON.stringify({ ...plan, _plannerTicketLimit: 1 }),
    });
    await expect(admitPlannerChild(deps, 'j_other_parent', { ...child, key: 'other' })).rejects.toMatchObject({
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
    const result = await admitPlannerChild(deps, parentId, child);
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
      admitPlannerChild(deps, parentId, child),
      admitPlannerChild(deps, parentId, { ...child, key: 'other' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    deps.sqlite.close();
  });
});
