import { ApiError, CreateJobRequest } from '@ogm/contracts';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app/app.js';
import { HttpError } from '../src/app/errors.js';
import type { ApiBindings } from '../src/app/types.js';
import { parseBody, parseQuery } from '../src/app/validate.js';
import { makeDeps } from './helpers.js';
import { z } from 'zod';

function appWith(routes: Hono<ApiBindings>) {
  const deps = makeDeps();
  const app = createApp(deps);
  app.route('/api/v1/t', routes);
  return { app, deps };
}

const routes = new Hono<ApiBindings>()
  .get('/402', () => {
    throw new HttpError(402, 'allowance_exceeded', 'over today', { remainingMicroUsd: 0 });
  })
  .get('/boom', () => {
    throw new Error('secret detail from the database');
  })
  .post('/jobs', async (c) => c.json(await parseBody(c, CreateJobRequest)))
  .get('/q', (c) => c.json(parseQuery(c, z.object({ userId: z.string().min(3) }))));

describe('error envelope', () => {
  it('turns an HttpError into its status and ApiError body', async () => {
    const response = await appWith(routes).app.request('/api/v1/t/402');
    expect(response.status).toBe(402);
    expect(ApiError.parse(await response.json())).toEqual({
      error: 'allowance_exceeded',
      message: 'over today',
      details: { remainingMicroUsd: 0 },
    });
  });

  it('hides an unexpected error behind internal and logs the stack with the request id', async () => {
    const { app, deps } = appWith(routes);
    const response = await app.request('/api/v1/t/boom', { headers: { 'x-request-id': 'r-1' } });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('secret detail');
    expect(JSON.parse(text)).toEqual({ error: 'internal', details: { requestId: 'r-1' } });
    expect(deps.lines.find((line) => line.event === 'error')).toMatchObject({ requestId: 'r-1' });
  });

  it('answers unknown paths with not_found', async () => {
    const response = await appWith(routes).app.request('/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('redacts invite tokens from unmatched request paths', async () => {
    const { app, deps } = appWith(routes);
    const requests = [
      { method: 'POST', path: '/api/v1/invites/trailing-secret/accept/' },
      { method: 'GET', path: '/api/v1/invites/get-secret' },
      { method: 'POST', path: '/api/v1/invites/extra-secret/accept/extra' },
      { method: 'POST', path: '//api/v1/invites/double-slash-secret/accept' },
      { method: 'GET', path: '/api/v1/join/join-secret' },
    ];

    for (const request of requests) {
      const response = await app.request(`http://localhost${request.path}`, { method: request.method });
      expect(response.status).toBe(404);
    }

    const requestPaths = deps.lines.filter(({ event }) => event === 'request').map(({ path }) => path);
    expect(requestPaths).toEqual([
      '/api/v1/invites/:token/accept/',
      '/api/v1/invites/:token',
      '/api/v1/invites/:token/accept/extra',
      '//api/v1/invites/:token/accept',
      '/api/v1/join/:token',
    ]);
    for (const { path } of requests) {
      const token = path.split(/\/(?:invites|join)\//)[1]?.split('/')[0];
      expect(JSON.stringify(deps.lines)).not.toContain(token);
    }
  });
});

describe('validation helpers', () => {
  it('rejects a body that breaks the contract with the issue path', async () => {
    const response = await appWith(routes).app.request('/api/v1/t/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01', kind: 'feature', complexity: 9 }),
    });
    expect(response.status).toBe(400);
    const body = ApiError.parse(await response.json());
    expect(body.error).toBe('invalid_request');
    expect((body.details as { path: string[] }[]).map(({ path }) => path.join('.'))).toContain('complexity');
  });

  it('rejects a body that is not JSON', async () => {
    const response = await appWith(routes).app.request('/api/v1/t/jobs', { method: 'POST', body: '{' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_json' });
  });

  it('parses and rejects query strings', async () => {
    const { app } = appWith(routes);
    expect(await (await app.request('/api/v1/t/q?userId=abc')).json()).toEqual({ userId: 'abc' });
    expect((await app.request('/api/v1/t/q?userId=a')).status).toBe(400);
  });
});
