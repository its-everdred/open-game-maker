import { describe, expect, it, vi } from 'vitest';

import { GitHubRateLimitError, GitHubRequestError, withSafeGitHubRequests } from '../src/github-request.js';
import type { GitHubRequest } from '../src/types.js';

function failure(status: number, headers: Record<string, string> = {}, message = 'failed') {
  return Object.assign(new Error(message), { status, response: { headers } });
}

describe('withSafeGitHubRequests', () => {
  it('honors Retry-After once', async () => {
    const request = vi
      .fn<GitHubRequest>()
      .mockRejectedValueOnce(failure(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce({ data: { ok: true } });
    const delay = vi.fn(async () => undefined);
    const safe = withSafeGitHubRequests(request, delay);
    await expect(safe('GET /app')).resolves.toEqual({ data: { ok: true } });
    expect(delay).toHaveBeenCalledWith(2_000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('fails closed after the single rate-limit retry', async () => {
    const request = vi.fn<GitHubRequest>().mockRejectedValue(
      failure(403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '101',
      }),
    );
    const safe = withSafeGitHubRequests(
      request,
      async () => undefined,
      () => 100_000,
    );
    await expect(safe('GET /app')).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('logs safe GitHub diagnostics without exposing arbitrary response data', async () => {
    const log = vi.fn();
    const error = Object.assign(failure(404), { response: { headers: {}, data: { message: 'Not Found' } } });
    const safe = withSafeGitHubRequests(vi.fn<GitHubRequest>().mockRejectedValue(error), undefined, undefined, log);
    await expect(safe('GET /repos/{owner}/{repo}/pulls')).rejects.toBeInstanceOf(GitHubRequestError);
    expect(log).toHaveBeenCalledWith({
      event: 'github-request-error',
      status: 404,
      endpoint: 'GET /repos/{owner}/{repo}/pulls',
      message: 'Not Found',
    });
    error.response.data.message =
      'GH013: Repository rule violations found for refs/heads/main\nSee https://example.invalid/?token=secret';
    await expect(safe('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge')).rejects.toBeInstanceOf(
      GitHubRequestError,
    );
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'GH013: Repository rule violations found' }),
    );
    error.response.data.message = 'token secret-installation-token';
    await expect(safe('GET /app')).rejects.toBeInstanceOf(GitHubRequestError);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-installation-token');
  });

  it('redacts the upstream message and response data', async () => {
    const request = vi
      .fn<GitHubRequest>()
      .mockRejectedValue(failure(401, {}, 'bad credentials for token secret-installation-token'));
    await expect(withSafeGitHubRequests(request)('GET /app')).rejects.toEqual(
      new GitHubRequestError('github request failed', 401),
    );
  });
});
