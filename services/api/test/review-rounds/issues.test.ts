import { expect, it, vi } from 'vitest';
vi.mock('@ogm/builder', () => ({ createIssuesClient: () => ({ ensureLabel: async () => {} }) }));
import { createReviewIssues } from '../../src/review-rounds/issues.js';

it('finds the created follow-up by marker after an indeterminate POST', async () => {
  let created: { number: number; body: string } | null = null;
  let writes = 0;
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === 'POST') {
      writes += 1;
      created = { number: 77, body: JSON.parse(String(init.body)).body as string };
      throw new Error('connection lost');
    }
    return new Response(JSON.stringify(created ? [created] : []), { status: 200 });
  });
  const issues = createReviewIssues('fixture-token', fetchImpl);
  const issue = { title: 'Convert art', body: '<!-- review-marker --> approved round' };
  await expect(issues.ensureFollowup('owner/repo', 'game', '<!-- review-marker -->', issue)).rejects.toThrow(
    'connection lost',
  );
  expect(await issues.ensureFollowup('owner/repo', 'game', '<!-- review-marker -->', issue)).toBe('77');
  expect(writes).toBe(1);
});
