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

it('closes a killed review as not planned', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
  await createReviewIssues('fixture-token', fetchImpl).cancel('owner/repo', '42');
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(String(url)).toContain('/repos/owner/repo/issues/42');
  expect(JSON.parse(String(init?.body))).toEqual({ state: 'closed', state_reason: 'not_planned' });
});

it.each([
  ['identical', true],
  ['ahead', true],
  ['behind', false],
  ['diverged', false],
])('recognizes whether the approved commit is in main (%s)', async (status, expected) => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status }), { status: 200 }));
  expect(await createReviewIssues('fixture-token', fetchImpl).integrated('owner/repo', 'a'.repeat(40))).toBe(expected);
  expect(String(fetchImpl.mock.calls[0]![0])).toContain(`/compare/${'a'.repeat(40)}...main`);
});
