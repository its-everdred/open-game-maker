import { schema } from '@ogm/db';
import { expect, it } from 'vitest';

import { awaitsBuild } from '../../src/builds/publish.js';
import { insertJob, worked } from '../budget/fixture.js';

it('finishes a New Game planner without waiting for a build upload', () => {
  const deps = worked();
  insertJob(deps, { id: 'j_planner', kind: 'new_game', state: 'running' });
  expect(awaitsBuild(deps, 'j_planner')).toBe(true);
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
  expect(awaitsBuild(deps, 'j_planner')).toBe(false);
  deps.sqlite.close();
});
