import { describe, expect, it } from 'vitest';
import { schema } from '@ogm/db';

import { weeklyJobs } from '../../src/budget/weekly-jobs.js';
import { ids, insertJob, NOW, worked, ZONE } from './fixture.js';

describe('weekly job budget', () => {
  it('counts each admitted job by creator and kind within the local week', () => {
    const deps = worked();
    insertJob(deps, { id: 'new-game', kind: 'new_game', slot: 'new_game' });
    insertJob(deps, { id: 'repair', kind: 'repair' });
    insertJob(deps, { id: 'scope', kind: 'scope' });
    insertJob(deps, { id: 'old', createdAt: '2026-10-25T12:00:00.000Z' });
    insertJob(deps, { id: 'other', creatorId: ids.other });
    expect(weeklyJobs(deps.db, ids.creator, NOW, ZONE)).toMatchObject({
      limits: { newGames: 2, edits: 20 },
      remaining: { newGames: 1, edits: 18 },
      resetsAt: '2026-11-02T08:00:00.000Z',
    });
  });

  it('reserves scheduled jobs in the week they will start', () => {
    const deps = worked();
    insertJob(deps, { id: 'scheduled', start: 'at_reset', startAt: '2026-11-02T08:00:00.000Z' });
    expect(weeklyJobs(deps.db, ids.creator, NOW, ZONE).remaining.edits).toBe(19);
    expect(weeklyJobs(deps.db, ids.creator, new Date('2026-11-02T08:00:00.000Z'), ZONE).remaining.edits).toBe(19);
  });

  it('uses explicit per-user limits, including unlimited', () => {
    const deps = worked();
    const date = new Date();
    deps.db
      .insert(schema.user)
      .values({
        id: ids.creator,
        name: 'Tester',
        email: 'tester@example.test',
        emailVerified: true,
        createdAt: date,
        updatedAt: date,
      })
      .run();
    deps.db
      .insert(schema.allowedUsers)
      .values({ email: 'tester@example.test', role: 'maker', addedBy: 'env', addedAt: date.toISOString() })
      .run();
    deps.db.insert(schema.weeklyJobBudgets).values({ email: 'tester@example.test', newGames: null, edits: 1 }).run();
    expect(weeklyJobs(deps.db, ids.creator, NOW, ZONE).remaining).toEqual({ newGames: null, edits: 0 });
  });
});
