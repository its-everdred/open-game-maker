import { describe, expect, it, vi } from 'vitest';

import type { AuditWriter } from '../src/audit.js';
import { createCommitApp } from '../src/server.js';
import type { CommitResult } from '../src/types.js';
import { contextWith, fakeRequest } from './helpers.js';

const serviceToken = 't'.repeat(32);

function setup(options: { remote?: string; result?: CommitResult; failure?: Error } = {}) {
  const { request } = fakeRequest(() => ({}));
  const complete = contextWith(request);
  const { repos, ...operations } = complete;
  const append = vi.fn<AuditWriter['append']>(async () => undefined);
  const execute = vi.fn(async () => {
    if (options.failure !== undefined) throw options.failure;
    return options.result ?? ({ ok: true, sha: 'tag-1' } as const);
  });
  const app = createCommitApp({
    serviceToken,
    operations,
    repos,
    audit: { append },
    remoteAddress: () => options.remote ?? '127.0.0.1',
    execute,
    now: () => new Date('2026-11-01T00:00:00.000Z'),
  });
  return { app, append, execute };
}

function releaseRequest(authorization?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify({
      kind: 'release',
      gameId: 'game-1',
      sha: 'commit-1',
      semver: '1.2.3',
      changelog: 'New level',
    }),
  };
}

describe('commit HTTP service', () => {
  it('refuses startup with a short service token', () => {
    const { request } = fakeRequest(() => ({}));
    const complete = contextWith(request);
    const { repos, ...operations } = complete;
    expect(() =>
      createCommitApp({
        serviceToken: 'too-short',
        operations,
        repos,
        audit: { async append() {} },
      }),
    ).toThrow('at least 32 bytes');
  });

  it('requires the service bearer before parsing the operation', async () => {
    const { app, append, execute } = setup();
    const response = await app.request('/internal/commit', releaseRequest());
    expect(response.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses a non-loopback peer', async () => {
    const { app, execute } = setup({ remote: '192.168.1.5' });
    const response = await app.request('/internal/commit', releaseRequest(`Bearer ${serviceToken}`));
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns 422 for an invalid operation', async () => {
    const { app, execute } = setup();
    const response = await app.request('/internal/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify({ kind: 'push', gameId: 'game-1' }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_op' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('audits an authenticated operation before returning its result', async () => {
    const { app, append, execute } = setup();
    const response = await app.request('/internal/commit', releaseRequest(`Bearer ${serviceToken}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, sha: 'tag-1' });
    expect(execute).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith({
      at: '2026-11-01T00:00:00.000Z',
      op: 'release',
      gameId: 'game-1',
      repo: 'alice/instance',
      result: 'allowed',
      sha: 'tag-1',
      actor: 'api',
    });
  });

  it('audits a refused operation with its verdict', async () => {
    const verdict = { allowed: false as const, reasons: [{ code: 'denylist' as const, detail: 'blocked' }] };
    const { app, append } = setup({ result: { ok: false, verdict } });
    const response = await app.request('/internal/commit', releaseRequest(`Bearer ${serviceToken}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: false, verdict });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ result: 'refused', verdict }));
  });

  it('refuses a concurrent retry while creation is still running', async () => {
    let finish!: (value: CommitResult) => void;
    const pending = new Promise<CommitResult>((resolve) => {
      finish = resolve;
    });
    const { request } = fakeRequest(() => ({}));
    const complete = contextWith(request);
    const { repos, ...operations } = complete;
    const execute = vi.fn(() => pending);
    const app = createCommitApp({
      serviceToken,
      operations,
      repos,
      audit: { async append() {} },
      remoteAddress: () => '127.0.0.1',
      execute,
    });
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify({
        kind: 'create_game',
        gameId: 'game-1',
        slug: 'game',
        visibility: 'private',
        templateRef: 'game-2d@1',
      }),
    };
    const first = app.request('/internal/commit', init);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const retry = app.request('/internal/commit', init);
    const retryStatus = await Promise.race([
      retry.then((response) => response.status),
      new Promise<number>((resolve) => setTimeout(() => resolve(0), 500)),
    ]);
    expect(execute).toHaveBeenCalledOnce();
    finish({ ok: true, sha: 'sha' });
    expect((await first).status).toBe(200);
    expect(retryStatus).toBe(409);
    expect((await app.request('/internal/commit', init)).status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('audits a failed operation before returning 502', async () => {
    const { app, append } = setup({ failure: new Error('upstream failed') });
    const response = await app.request('/internal/commit', releaseRequest(`Bearer ${serviceToken}`));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'commit operation failed' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ result: 'error' }));
  });
});
