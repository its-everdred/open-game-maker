import { expect, it, vi } from 'vitest';
vi.mock('@ogm/builder', () => ({ createIssuesClient: () => ({ ensureLabel: async () => {} }) }));
import { createReviewIssues } from '../../src/review-rounds/issues.js';

it('closes a killed review as not planned', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
  await createReviewIssues('fixture-token', fetchImpl).cancel('owner/repo', '42');
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(String(url)).toContain('/repos/owner/repo/issues/42');
  expect(JSON.parse(String(init?.body))).toEqual({ state: 'closed', state_reason: 'not_planned' });
});

it('replaces only fidelity and effort labels, preserving other model labels', async () => {
  const labels = ['phase:mock', 'phase:prototype', 'model:low', 'model:high', 'model:remote', 'bug'];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (init?.method === 'GET') return new Response(JSON.stringify(labels.map((name) => ({ name }))));
    if (init?.method === 'DELETE') {
      const name = decodeURIComponent(url.split('/').at(-1)!);
      labels.splice(labels.indexOf(name), 1);
      return new Response(null, { status: 204 });
    }
    if (init?.method === 'POST') labels.push(...(JSON.parse(String(init.body)).labels as string[]));
    return new Response('{}');
  });
  const issues = createReviewIssues('fixture-token', fetchImpl);
  await issues.setFidelity('owner/repo', '42', 'build', 'xhigh');
  await issues.setFidelity('owner/repo', '42', 'build', 'xhigh');
  expect(labels.sort()).toEqual(['bug', 'model:remote', 'model:xhigh', 'phase:build']);
});
