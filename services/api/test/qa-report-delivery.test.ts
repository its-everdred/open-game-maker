import { expect, it, vi } from 'vitest';

import { qaIssue, notifyQaIssue } from '../src/reports/qa-delivery.js';

it('files a non-dispatching game issue with a private diagnostics link', async () => {
  const input = { reportId: 'r_1', gameId: 'g_1', buildHash: 'b_1', appOrigin: 'https://example.test' };
  expect(qaIssue(input)).toEqual({
    gameId: 'g_1',
    title: 'Bug report',
    body: 'Build: b_1\n\n[Private report and logs](https://example.test/api/v1/reports/r_1)\n[Private screenshot, if captured](https://example.test/api/v1/reports/r_1/screenshot)\n[Private bundle, if attached](https://example.test/api/v1/reports/r_1/bundle)',
    labels: ['needs-triage'],
  });
});

it('includes only allowlisted error classes in the public issue', () => {
  const input = { reportId: 'r_1', gameId: 'g_1', appOrigin: 'https://example.test' };
  expect(qaIssue({ ...input, errorType: 'TypeError' }).body).toContain('Error: TypeError');
  expect(qaIssue({ ...input, errorType: 'secret-token' }).body).not.toContain('secret-token');
});

it('notifies the Executor with an idempotent report key', async () => {
  const sendExecutorThreadMessage = vi.fn().mockResolvedValue({});
  await notifyQaIssue(
    { sendExecutorThreadMessage },
    { reportId: 'r_1', gameId: 'g_1', repository: 'owner/games', ref: 'issue:42' },
  );
  expect(sendExecutorThreadMessage).toHaveBeenCalledWith(
    {
      text: 'A bug report for game g_1 was filed for triage in owner/games (issue:42).',
      client_request_id: 'qa-report:r_1',
    },
    expect.any(AbortSignal),
  );
});
