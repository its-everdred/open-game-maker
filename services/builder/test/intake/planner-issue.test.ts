import { describe, expect, it } from 'vitest';

import { plannerIssue } from '../../src/intake/planner-issue.js';

describe('New Game planner issue', () => {
  it('links the parent and carries a retry marker and configured child limit', () => {
    const issue = plannerIssue({ jobId: 'j_1', parentNumber: 42, gameSlug: 'lantern-bay', ticketLimit: 3 });
    expect(issue.body).toContain('request in #42');
    expect(issue.body).toContain('Maximum child tickets for this game: 3');
    expect(issue.body).toContain(`gm-job:j_1 gm-ticket:new-game-plan gm-sig:${issue.sig}`);
    expect(issue.labels).toContain('feature:gm-j_1');
    expect(plannerIssue({ jobId: 'j_1', parentNumber: 42, gameSlug: 'lantern-bay', ticketLimit: 3 })).toEqual(issue);
  });

  it.each([0, -1, 1.5, Infinity, NaN])('rejects invalid limits: %s', (ticketLimit) => {
    expect(() => plannerIssue({ jobId: 'j_1', parentNumber: 42, gameSlug: 'lantern-bay', ticketLimit })).toThrow();
  });
});
