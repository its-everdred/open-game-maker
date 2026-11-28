import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { plannerRequest } from '../../src/previews/new-game.js';
import { ids, insertJob, worked } from '../budget/fixture.js';

describe('planner context grant', () => {
  it('authorizes only the recorded, active planner ticket, repository and game', () => {
    const deps = worked();
    insertJob(deps, { id: 'j_planner', kind: 'new_game', aiurIssueNumber: 42 });
    deps.db
      .insert(schema.jobTickets)
      .values({
        jobId: 'j_planner',
        key: 'new-game-plan',
        issueNumber: 42,
        repo: 'example/games',
        sig: 'sig',
      })
      .run();
    expect(plannerRequest(deps.db, 'example/games', 42, ids.game)).toBe('j_planner');
    expect(plannerRequest(deps.db, 'example/other', 42, ids.game)).toBeNull();
    expect(plannerRequest(deps.db, 'example/games', 43, ids.game)).toBeNull();
    expect(plannerRequest(deps.db, 'example/games', 42, 'g_other')).toBeNull();
    deps.db.update(schema.jobs).set({ state: 'cancelled' }).where(eq(schema.jobs.id, 'j_planner')).run();
    expect(plannerRequest(deps.db, 'example/games', 42, ids.game)).toBeNull();
    deps.sqlite.close();
  });
});
