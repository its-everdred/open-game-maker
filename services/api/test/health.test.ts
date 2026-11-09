import { HealthResponse } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { recordSupervisorTokenStatus } from '../src/job-commands/health.js';
import { makeApp } from './helpers.js';

describe('GET /healthz', () => {
  it('answers in the shared health.v1 shape', async () => {
    const { app } = await makeApp();
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    const body = HealthResponse.parse(await response.json());
    expect(body).toMatchObject({ ok: true, service: 'api', version: 'test-version' });
    expect(body.uptimeSec).toBeGreaterThanOrEqual(5);
  });

  it('reports daemon slugs with missing command supervisor tokens', async () => {
    const { app, deps } = await makeApp();
    recordSupervisorTokenStatus(deps, 'game-1', true);

    const response = await app.request('/healthz');
    const body = HealthResponse.parse(await response.json());
    expect(body.details).toEqual({
      command_decisions: { ok: false, missing_supervisor_token_daemons: ['game-1'] },
    });
  });

  it('tags the response with a request id and logs one line without the body', async () => {
    const { app, deps } = await makeApp();
    const response = await app.request('/healthz', { headers: { 'x-request-id': 'req-123' } });
    expect(response.headers.get('x-request-id')).toBe('req-123');
    expect(deps.lines.filter((line) => line.event === 'request')).toEqual([
      { event: 'request', method: 'GET', path: '/healthz', status: 200, ms: expect.any(Number), requestId: 'req-123' },
    ]);
  });

  it('replaces a malformed request id', async () => {
    const { app } = await makeApp();
    const response = await app.request('/healthz', { headers: { 'x-request-id': 'bad id\n' } });
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
