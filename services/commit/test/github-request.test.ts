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
    let now = 0;
    const delay = vi.fn(async (ms: number) => {
      now += ms;
    });
    const safe = withSafeGitHubRequests(request, delay, () => now);
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
    let now = 100_000;
    const safe = withSafeGitHubRequests(
      request,
      async (ms) => {
        now += ms;
      },
      () => now,
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

  it('identifies secondary limits and reports long backoff without blocking the caller', async () => {
    const error = Object.assign(failure(403), {
      response: {
        headers: { 'retry-after': '60', 'x-ratelimit-remaining': '3270', authorization: 'secret' },
        data: { message: 'You have exceeded a secondary rate limit. Please wait.' },
      },
    });
    const request = vi.fn<GitHubRequest>().mockRejectedValue(error);
    const delay = vi.fn(async () => undefined);
    const log = vi.fn();
    await expect(
      withSafeGitHubRequests(request, delay, Date.now, log)('POST /repos/{owner}/{repo}/git/trees'),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(request).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'GitHub secondary rate limit',
        rateLimit: { 'retry-after': '60', 'x-ratelimit-remaining': '3270' },
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });

  it('does not retry if another request extends the cooldown during backoff', async () => {
    let now = 1000;
    const cooldown = { until: 0 };
    const request = vi.fn<GitHubRequest>().mockRejectedValue(failure(429, { 'retry-after': '1' }));
    const delay = async (ms: number) => {
      now += ms;
      cooldown.until = now + 60_000;
    };
    await expect(
      withSafeGitHubRequests(request, delay, () => now, undefined, cooldown)('GET /app'),
    ).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(request).toHaveBeenCalledOnce();
  });

  it('honors a long cooldown across request wrappers', async () => {
    let now = 1000;
    const cooldown = { until: 0 };
    const error = Object.assign(failure(403), {
      response: { headers: { 'retry-after': '60' }, data: { message: 'secondary rate limit' } },
    });
    const request = vi.fn<GitHubRequest>().mockRejectedValueOnce(error).mockResolvedValue({ data: {} });
    const delay = async (ms: number) => {
      now += ms;
    };
    const first = withSafeGitHubRequests(request, delay, () => now, undefined, cooldown);
    const second = withSafeGitHubRequests(request, delay, () => now, undefined, cooldown);
    await expect(first('POST /repos/{owner}/{repo}/git/trees')).rejects.toBeInstanceOf(GitHubRateLimitError);
    await expect(second('POST /repos/{owner}/{repo}/git/trees')).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(request).toHaveBeenCalledOnce();
    now += 60_000;
    await expect(second('POST /repos/{owner}/{repo}/git/trees')).resolves.toEqual({ data: {} });
  });

  it('logs only recognized validation codes for tree errors', async () => {
    const error = Object.assign(failure(422), {
      response: {
        headers: {},
        data: { message: 'Validation Failed', errors: [{ code: 'invalid', field: 'secret' }, { code: 'secret' }] },
      },
    });
    const log = vi.fn();
    await expect(
      withSafeGitHubRequests(
        vi.fn<GitHubRequest>().mockRejectedValue(error),
        undefined,
        undefined,
        log,
      )('POST /repos/{owner}/{repo}/git/trees'),
    ).rejects.toBeInstanceOf(GitHubRequestError);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Validation Failed', validationCodes: ['invalid'] }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
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
