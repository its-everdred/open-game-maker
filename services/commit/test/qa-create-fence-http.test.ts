import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { QaCreateFence } from '../src/qa-create-fence.js';
import { createCommitApp } from '../src/server.js';
import { contextWith, fakeRequest } from './helpers.js';

describe('QA create fence HTTP', () => {
  it('drains an already executing create before reporting the fence ready', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-fence-drain-'));
    try {
      const { request } = fakeRequest(() => ({}));
      const { repos, ...operations } = contextWith(request);
      const token = 't'.repeat(32);
      let start!: () => void;
      let finish!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const app = createCommitApp({
        serviceToken: token,
        operations,
        repos,
        audit: { append: async () => undefined },
        remoteAddress: () => '127.0.0.1',
        qaCreateFence: new QaCreateFence(dir),
        execute: async () => {
          start();
          await pending;
          return { ok: true as const, sha: 'created' };
        },
      });
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const createBody = JSON.stringify({
        kind: 'create_game',
        gameId: 'g_example',
        slug: 'qa',
        templateRef: 'default',
        visibility: 'private',
      });
      const create = app.request('/internal/commit', { method: 'POST', headers, body: createBody });
      await started;
      const path = '/internal/qa/create-fence/g_example';
      const body = JSON.stringify({ owner: 'run-1' });
      try {
        expect(await (await app.request(path, { method: 'POST', headers, body })).json()).toEqual({ ready: false });
        expect((await app.request('/internal/commit', { method: 'POST', headers, body: createBody })).status).toBe(409);
      } finally {
        finish();
      }
      expect((await create).status).toBe(200);
      expect(await (await app.request(path, { method: 'POST', headers, body })).json()).toEqual({ ready: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('drains a refused create so cleanup can acquire the fence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-fence-refused-'));
    try {
      const { request } = fakeRequest(() => ({}));
      const { repos, ...operations } = contextWith(request);
      const token = 't'.repeat(32);
      const app = createCommitApp({
        serviceToken: token,
        operations,
        repos,
        audit: { append: async () => undefined },
        remoteAddress: () => '127.0.0.1',
        qaCreateFence: new QaCreateFence(dir),
        execute: async () => ({
          ok: false as const,
          verdict: { allowed: false, reasons: [{ code: 'path' as const, detail: 'reserved path' }] },
        }),
      });
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const body = JSON.stringify({
        kind: 'create_game',
        gameId: 'g_example',
        slug: 'qa',
        templateRef: 'default',
        visibility: 'private',
      });
      expect((await app.request('/internal/commit', { method: 'POST', headers, body })).status).toBe(200);
      const fence = await app.request('/internal/qa/create-fence/g_example', {
        method: 'POST',
        headers,
        body: JSON.stringify({ owner: 'run-1' }),
      });
      expect(await fence.json()).toEqual({ ready: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps a marker after an ambiguous create failure, including after service restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-fence-failure-'));
    try {
      const { request } = fakeRequest(() => ({}));
      const { repos, ...operations } = contextWith(request);
      const token = 't'.repeat(32);
      const app = createCommitApp({
        serviceToken: token,
        operations,
        repos,
        audit: { append: async () => undefined },
        remoteAddress: () => '127.0.0.1',
        qaCreateFence: new QaCreateFence(dir),
        execute: async () => {
          throw new Error('remote response lost');
        },
      });
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const create = await app.request('/internal/commit', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'create_game',
          gameId: 'g_example',
          slug: 'qa',
          templateRef: 'default',
          visibility: 'private',
        }),
      });
      expect(create.status).toBe(502);
      expect(await new QaCreateFence(dir).acquire('g_example', 'run-1')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires the service token and refuses create while fenced', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-fence-http-'));
    try {
      const { request } = fakeRequest(() => ({}));
      const { repos, ...operations } = contextWith(request);
      const execute = vi.fn(async () => ({ ok: true as const, sha: 'created' }));
      const token = 't'.repeat(32);
      const app = createCommitApp({
        serviceToken: token,
        operations,
        repos,
        audit: { append: async () => undefined },
        remoteAddress: () => '127.0.0.1',
        qaCreateFence: new QaCreateFence(dir),
        execute,
      });
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const path = '/internal/qa/create-fence/g_example';
      const body = JSON.stringify({ owner: 'run-1' });
      expect((await app.request(path, { method: 'POST', body })).status).toBe(401);
      expect(await (await app.request(path, { method: 'POST', headers, body })).json()).toEqual({ ready: true });
      const create = await app.request('/internal/commit', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'create_game',
          gameId: 'g_example',
          slug: 'qa',
          templateRef: 'default',
          visibility: 'private',
        }),
      });
      expect(create.status).toBe(409);
      expect(execute).not.toHaveBeenCalled();
      expect((await app.request(path, { method: 'DELETE', headers, body })).status).toBe(200);
      const afterRelease = await app.request('/internal/commit', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind: 'create_game',
          gameId: 'g_example',
          slug: 'qa',
          templateRef: 'default',
          visibility: 'private',
        }),
      });
      expect(afterRelease.status).toBe(200);
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
