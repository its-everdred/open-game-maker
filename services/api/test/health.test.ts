import { HealthResponse } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { recordReconcileHeartbeat } from '../src/review-rounds/heartbeat.js';
import { recordDaemonReadTokenStatus, recordSupervisorTokenStatus } from '../src/job-commands/health.js';
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

  it('exposes a stopped review reconciler in health details', async () => {
    const { app, deps } = await makeApp();
    recordReconcileHeartbeat(deps.db, Date.now() - (deps.config.commandPollMs ?? 5000) * 2);
    const stale = HealthResponse.parse(await (await app.request('/healthz')).json());
    expect(stale.details).toMatchObject({ review_rounds: { ok: false } });
    recordReconcileHeartbeat(deps.db, Date.now());
    const fresh = HealthResponse.parse(await (await app.request('/healthz')).json());
    expect(fresh.details).toMatchObject({ review_rounds: { ok: true } });
  });

  it('reports daemon slugs with missing command supervisor tokens', async () => {
    const { app, deps } = await makeApp();
    recordSupervisorTokenStatus(deps, 'game-1', true);

    const response = await app.request('/healthz');
    const body = HealthResponse.parse(await response.json());
    expect(body.details).toMatchObject({
      command_decisions: { ok: false, missing_supervisor_token_daemons: ['game-1'] },
    });
  });

  it('updates command health when the fleet reports a missing read token and its recovery', async () => {
    const { app, deps } = await makeApp();
    recordDaemonReadTokenStatus(deps, 'game-1', true);

    const missing = HealthResponse.parse(await (await app.request('/healthz')).json());
    expect(missing.details).toMatchObject({
      command_decisions: { ok: false, missing_supervisor_token_daemons: ['game-1'] },
    });

    recordDaemonReadTokenStatus(deps, 'game-1', false);

    const recovered = HealthResponse.parse(await (await app.request('/healthz')).json());
    expect(recovered.details).toMatchObject({
      command_decisions: { ok: true, missing_supervisor_token_daemons: [] },
    });
    expect(deps.lines.filter((line) => line.event === 'daemon-read-token-status')).toEqual([
      { event: 'daemon-read-token-status', daemon: 'game-1', status: 'missing' },
      { event: 'daemon-read-token-status', daemon: 'game-1', status: 'present' },
    ]);
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
