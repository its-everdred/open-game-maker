import { describe, expect, it, vi } from 'vitest';

import { CommitServiceIssueWriter } from '../src/reports/issue-writer.js';

describe('CommitServiceIssueWriter', () => {
  it('routes a game report to its repository with the triage label', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true, sha: 'issue:42' }));
    const writer = new CommitServiceIssueWriter({ baseUrl: 'http://127.0.0.1:4301', token: 'test', fetch: request });

    await expect(
      writer.file({ gameId: 'g_1', title: 'Report', body: 'Build b_1', labels: ['needs-triage'] }),
    ).resolves.toEqual({ ref: 'issue:42' });
    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'file_issue',
      gameId: 'g_1',
      title: 'Report',
      body: 'Build b_1',
      labels: ['needs-triage'],
    });
  });
});
