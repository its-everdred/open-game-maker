import { describe, expect, it, vi } from 'vitest';

import { createIssuesClient, OutcomeUnknownError, type GitHubRequest } from '../../src/github/issues.js';

function response(status: number, data: unknown, headers: Record<string, string> = {}) {
  return { status, data, headers };
}

function requestError(status: number, data: unknown, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { status, response: { status, data, headers } });
}

describe('GitHub issues writer', () => {
  it('checks the game pinned core commit contains gm-prototype', async () => {
    const sha = 'a'.repeat(40);
    const manifest = Buffer.from(JSON.stringify({ core: { sha, ref: 'main' } })).toString('base64');
    const request = vi
      .fn<GitHubRequest>()
      .mockResolvedValueOnce(response(200, { encoding: 'base64', content: manifest }))
      .mockResolvedValueOnce(response(200, { type: 'file' }));
    expect(
      await createIssuesClient({ token: 'fixture', request }).hasPrototypeSkill('owner/game', 'example/core'),
    ).toBe(true);
    expect(request).toHaveBeenLastCalledWith(
      'GET /repos/{owner}/{repo}/contents/{path}',
      expect.objectContaining({ owner: 'example', repo: 'core', path: 'skills/gm-prototype/SKILL.md', ref: sha }),
    );
    const missing = vi
      .fn<GitHubRequest>()
      .mockResolvedValueOnce(response(200, { encoding: 'base64', content: manifest }))
      .mockRejectedValueOnce(requestError(404, {}));
    expect(
      await createIssuesClient({ token: 'fixture', request: missing }).hasPrototypeSkill('owner/game', 'example/core'),
    ).toBe(false);
    const upstream = vi
      .fn<GitHubRequest>()
      .mockResolvedValueOnce(response(200, { encoding: 'base64', content: manifest }))
      .mockResolvedValueOnce(response(200, { type: 'file' }));
    expect(await createIssuesClient({ token: 'fixture', request: upstream }).hasPrototypeSkill('owner/game')).toBe(
      true,
    );
    expect(upstream).toHaveBeenLastCalledWith(
      'GET /repos/{owner}/{repo}/contents/{path}',
      expect.objectContaining({ repo: 'open-game-maker', ref: sha }),
    );
  });
  it('creates an issue and rejects an ambiguous success without a number', async () => {
    const request = vi
      .fn<GitHubRequest>()
      .mockResolvedValueOnce(response(201, { number: 42, html_url: 'https://example.test/issues/42' }))
      .mockResolvedValueOnce(response(202, { accepted: true }));
    const client = createIssuesClient({ token: 'secret-token-value', request });
    const issue = { title: 'Build it', body: '<!-- gm-job:j_1 gm-ticket:T1 gm-sig:a -->', labels: ['complexity:2'] };

    await expect(client.create('Owner/Game', issue)).resolves.toEqual({
      number: 42,
      url: 'https://example.test/issues/42',
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      'POST /repos/{owner}/{repo}/issues',
      expect.objectContaining({ owner: 'Owner', repo: 'Game', ...issue }),
    );
    await expect(client.create('owner/game', issue)).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it('finds the exact job and ticket marker among feature-labelled issues', async () => {
    const request = vi.fn<GitHubRequest>().mockResolvedValue(
      response(200, [
        { number: 8, body: '<!-- gm-job:j_other gm-ticket:T1 gm-sig:x -->', labels: [] },
        {
          number: 9,
          html_url: 'https://example.test/issues/9',
          body: 'body\n\n<!-- gm-job:j_1 gm-ticket:T1 gm-sig:y -->',
          labels: [{ name: 'complexity:3' }, { name: 'feature:gm-j_1' }],
        },
      ]),
    );
    const client = createIssuesClient({ token: 'secret-token-value', request });

    await expect(client.findByMarkers('owner/game', 'j_1', 'T1')).resolves.toEqual({
      number: 9,
      url: 'https://example.test/issues/9',
      labels: ['complexity:3', 'feature:gm-j_1'],
    });
    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/issues',
      expect.objectContaining({ owner: 'owner', repo: 'game', labels: 'feature:gm-j_1', state: 'all', per_page: 100 }),
    );
  });

  it('treats an existing label as success and retries a rate limit using Retry-After', async () => {
    const sleeps: number[] = [];
    const request = vi
      .fn<GitHubRequest>()
      .mockRejectedValueOnce(requestError(422, { errors: [{ code: 'already_exists' }] }))
      .mockRejectedValueOnce(requestError(403, {}, { 'retry-after': '1', 'x-ratelimit-remaining': '0' }))
      .mockResolvedValueOnce(response(200, { labels: [{ name: 'complexity:2' }] }));
    const client = createIssuesClient({
      token: 'secret-token-value',
      request,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await expect(client.ensureLabel('owner/game', 'feature:gm-j_1', '0e8a16', 'OGM job')).resolves.toBeUndefined();
    await expect(client.labels('owner/game', 7)).resolves.toEqual(['complexity:2']);
    expect(sleeps).toEqual([1000]);
  });

  it('retries a server failure three times and redacts the token from the terminal error', async () => {
    const sleeps: number[] = [];
    const request = vi.fn<GitHubRequest>();
    request.mockImplementation(async () => {
      throw Object.assign(new Error('request failed with secret-token-value'), {
        status: 503,
        response: { status: 503, data: { message: 'offline' }, headers: {} },
      });
    });
    const client = createIssuesClient({
      token: 'secret-token-value',
      request,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const failure = await client.labels('owner/game', 7).catch((error: unknown) => error as Error);

    expect(request).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(failure.message).not.toContain('secret-token-value');
    expect(failure.message).toContain('[REDACTED]');
  });

  it('removes competing state labels under the daemon prefix only', async () => {
    const request = vi
      .fn<GitHubRequest>()
      .mockResolvedValueOnce(response(200, {}))
      .mockResolvedValueOnce(
        response(200, { labels: [{ name: 'castle-run:todo' }, { name: 'castle-run:paused' }, { name: 'agent:todo' }] }),
      )
      .mockResolvedValue(response(200, {}));
    const client = createIssuesClient({ token: 'secret-token-value', request });

    await client.setStateLabel('owner/game', 7, 'cancelled', 'castle-run');

    expect(request.mock.calls.map(([route]) => route)).toEqual([
      'POST /repos/{owner}/{repo}/labels',
      'GET /repos/{owner}/{repo}/issues/{issue_number}',
      'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
      'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
      'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
    ]);
    // Only this game's labels are cleared: another daemon's `agent:*` label on the shared repo stays put.
    expect(request.mock.calls.slice(2, 4).map(([, params]) => (params as { name: string }).name)).toEqual([
      'castle-run:todo',
      'castle-run:paused',
    ]);
    expect(request).toHaveBeenLastCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
      expect.objectContaining({ labels: ['castle-run:cancelled'] }),
    );
  });
});
