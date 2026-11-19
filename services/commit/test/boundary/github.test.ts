import { createHmac } from 'node:crypto';

import type { BoundaryVerdict } from '@ogm/contracts';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { BoundaryCheckPoster } from '../../src/boundary/check-run.js';
import { buildDiffInput } from '../../src/boundary/inputs.js';
import { runBoundaryPoll } from '../../src/boundary/poller.js';
import { registerBoundaryWebhook } from '../../src/boundary/webhook.js';
import type { ActiveRepository } from '../../src/boundary/api-client.js';
import type { AuthenticatedGitHub, GitHubApp, GitHubIdentity } from '../../src/types.js';
import { fakeRequest } from '../helpers.js';

const repository = {
  owner: 'alice',
  name: 'instance',
  visibility: 'private',
  path: 'games/castle-game',
  slug: 'castle-game',
} as const satisfies ActiveRepository;
const game = { owner: repository.owner, name: repository.name, visibility: repository.visibility } as const;
const emptyLock = { version: 1, family: 'any', pov: 'iso', assets: [] };

function appWith(request: AuthenticatedGitHub['request']): GitHubApp {
  return {
    async forOwner() {
      return { accountType: 'User', request };
    },
    async identity(): Promise<GitHubIdentity> {
      return { name: 'ogm-app[bot]', email: 'ogm-app[bot]@users.noreply.github.com' };
    },
  };
}

describe('GitHub boundary input', () => {
  it('paginates changed files, hashes blobs, and reads the lock at the pull head', async () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/pulls/{pull_number}')) {
        return { head: { sha: 'head-1' }, draft: true };
      }
      if (call.route.endsWith('/pulls/{pull_number}/files')) {
        if (call.parameters.page === 1) {
          return Array.from({ length: 100 }, (_, index) => ({
            filename: `removed/${index}.txt`,
            status: 'removed',
            sha: `removed-${index}`,
          }));
        }
        return [{ filename: 'README.md', status: 'modified', sha: 'blob-1' }];
      }
      if (call.route.endsWith('/git/blobs/{file_sha}')) {
        const content = Buffer.from(`token=${token}\n`).toString('base64');
        return { content, encoding: 'base64', size: Buffer.byteLength(`token=${token}\n`) };
      }
      if (call.route.endsWith('/contents/{path}')) {
        return { content: Buffer.from(JSON.stringify(emptyLock)).toString('base64'), encoding: 'base64' };
      }
      throw new Error(`unexpected route ${call.route}`);
    });

    const built = await buildDiffInput({
      request,
      repository,
      prNumber: 7,
      blocklist: new Set(),
      profileNames: ['Alice Example'],
    });

    expect(built.headSha).toBe('head-1');
    expect(built.input).toMatchObject({
      draft: true,
      mode: 'diff',
      visibility: 'private',
      profileNames: ['Alice Example'],
    });
    expect(built.input.files.find(({ path }) => path === 'README.md')).toMatchObject({
      path: 'README.md',
      status: 'modified',
      binary: false,
      content: `token=${token}\n`,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(calls.filter(({ route }) => route.endsWith('/pulls/{pull_number}/files'))).toHaveLength(2);
    expect(calls.find(({ route }) => route.endsWith('/contents/{path}'))?.parameters).toMatchObject({
      path: 'assets.lock.json',
      ref: 'head-1',
    });
  });
});

describe('boundary check run', () => {
  it('posts once per head sha and failure output never includes a matched secret', async () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
    const verdict: BoundaryVerdict = {
      allowed: false,
      reasons: [{ code: 'secret', path: 'README.md', detail: 'token-like string at line 1' }],
    };
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/check-runs') && call.route.startsWith('GET')) return { total_count: 0, check_runs: [] };
      if (call.route.endsWith('/check-runs') && call.route.startsWith('POST')) return { id: 1 };
      throw new Error(`unexpected route ${call.route}`);
    });
    const poster = new BoundaryCheckPoster({ delay: async () => {} });

    await poster.post(request, repository, 'head-1', verdict);
    await poster.post(request, repository, 'head-1', verdict);

    const posts = calls.filter(({ route }) => route.startsWith('POST'));
    const reads = calls.filter(({ route }) => route.startsWith('GET'));
    expect(posts).toHaveLength(1);
    expect(reads).toHaveLength(1);
    expect(posts[0]?.parameters).toMatchObject({
      name: 'ogm/boundary',
      head_sha: 'head-1',
      status: 'completed',
      conclusion: 'failure',
      output: expect.objectContaining({ summary: expect.stringContaining('README.md') }),
    });
    expect(JSON.stringify(posts[0]?.parameters)).not.toContain(token);
  });

  it('coalesces concurrent posts for the same head sha', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/check-runs') && call.route.startsWith('GET')) return { total_count: 0, check_runs: [] };
      if (call.route.endsWith('/check-runs') && call.route.startsWith('POST')) return { id: 1 };
      throw new Error(`unexpected route ${call.route}`);
    });
    const poster = new BoundaryCheckPoster({ delay: async () => {} });
    const verdict: BoundaryVerdict = { allowed: true, reasons: [] };

    await Promise.all([
      poster.post(request, repository, 'head-concurrent', verdict),
      poster.post(request, repository, 'head-concurrent', verdict),
    ]);

    expect(calls.filter(({ route }) => route.startsWith('GET'))).toHaveLength(1);
    expect(calls.filter(({ route }) => route.startsWith('POST'))).toHaveLength(1);
  });

  it('retries transient check-run failures three times', async () => {
    let posts = 0;
    const { request } = fakeRequest((call) => {
      if (call.route.startsWith('GET')) return { total_count: 0, check_runs: [] };
      posts += 1;
      if (posts < 3) throw new Error('transient');
      return { id: 2 };
    });
    const poster = new BoundaryCheckPoster({ delay: async () => {} });

    await poster.post(request, repository, 'head-2', { allowed: true, reasons: [] });

    expect(posts).toBe(3);
  });

  it('replaces a pending same-name run with a terminal verdict', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.startsWith('GET')) {
        return { total_count: 1, check_runs: [{ name: 'ogm/boundary', status: 'in_progress', conclusion: null }] };
      }
      return { id: 3 };
    });
    const poster = new BoundaryCheckPoster({ delay: async () => {} });

    await poster.post(request, repository, 'head-pending', { allowed: true, reasons: [] });

    expect(calls.filter(({ route }) => route.startsWith('POST'))).toHaveLength(1);
  });
});

describe('boundary poller', () => {
  it('checks every open pull request from active game repositories', async () => {
    const { request, calls } = fakeRequest((call) => {
      if (call.route.endsWith('/pulls')) {
        return call.parameters.page === 1 ? [{ number: 7, draft: false, head: { sha: 'head-7' } }] : [];
      }
      throw new Error(`unexpected route ${call.route}`);
    });
    const check = vi.fn(async () => {});

    await runBoundaryPoll({
      api: { activeRepositories: async () => [{ gameId: 'game-1', ...repository }] },
      app: appWith(request),
      check,
      log: vi.fn(),
    });

    expect(calls[0]?.parameters.repo).toBe(repository.name);
    expect(check).toHaveBeenCalledWith({
      repository: game,
      pull: { number: 7, draft: false, headSha: 'head-7' },
      games: [{ gameId: 'game-1', path: repository.path }],
    });
  });

  it('scans active repositories concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const { request } = fakeRequest(async (call) => {
      if (!call.route.endsWith('/pulls')) throw new Error(`unexpected route ${call.route}`);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return [];
    });

    await runBoundaryPoll({
      api: {
        activeRepositories: async () => [
          { gameId: 'game-1', ...repository },
          { gameId: 'game-2', ...repository, name: 'other-instance' },
        ],
      },
      app: appWith(request),
      check: vi.fn(async () => {}),
      log: vi.fn(),
    });

    expect(maxActive).toBe(2);
  });
});

describe('boundary webhook', () => {
  it('validates the raw body signature before checking an eligible pull request event', async () => {
    const app = new Hono();
    const run = vi.fn(async () => {});
    const payload = JSON.stringify({
      action: 'synchronize',
      repository: { name: repository.name, private: true, owner: { login: repository.owner } },
      pull_request: { number: 7, draft: false, head: { sha: 'head-7' } },
    });
    const secret = 'webhook-secret-for-tests';
    registerBoundaryWebhook(app, {
      secret,
      resolveRepository: async () => [{ gameId: 'game-1', ...repository }],
      run,
    });

    const bad = await app.request('/internal/github/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'pull_request', 'x-hub-signature-256': 'sha256=bad' },
      body: payload,
    });
    expect(bad.status).toBe(401);
    expect(run).not.toHaveBeenCalled();

    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    const good = await app.request('/internal/github/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'pull_request', 'x-hub-signature-256': signature },
      body: payload,
    });
    expect(good.status).toBe(202);
    expect(run).toHaveBeenCalledWith({
      repository: game,
      pull: { number: 7, draft: false, headSha: 'head-7' },
      games: [{ gameId: 'game-1', path: repository.path }],
    });
  });

  it('acknowledges a valid webhook before its boundary check completes', async () => {
    const app = new Hono();
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const payload = JSON.stringify({
      action: 'opened',
      repository: { name: repository.name, owner: { login: repository.owner } },
      pull_request: { number: 8, draft: false, head: { sha: 'head-8' } },
    });
    const secret = 'webhook-secret-for-tests';
    registerBoundaryWebhook(app, {
      secret,
      resolveRepository: async () => [{ gameId: 'game-1', ...repository }],
      run,
    });

    const response = await app.request('/internal/github/webhook', {
      method: 'POST',
      headers: {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`,
      },
      body: payload,
    });
    expect(response.status).toBe(202);
    finish();
  });

  it('rejects an oversized webhook before signature verification', async () => {
    const app = new Hono();
    const run = vi.fn(async () => {});
    registerBoundaryWebhook(app, { secret: 'secret', resolveRepository: async () => [], run });

    const response = await app.request('/internal/github/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'pull_request', 'x-hub-signature-256': 'sha256=invalid' },
      body: 'x'.repeat(1024 * 1024 + 1),
    });

    expect(response.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });
});
