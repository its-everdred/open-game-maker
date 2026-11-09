import { HealthResponse } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { healthResponse } from '../src/index.js';

describe('healthResponse', () => {
  it('reports whole seconds since start in the health.v1 shape', () => {
    const body = healthResponse({ service: 'api', version: 'abc123', startedAtMs: 10_000, nowMs: 72_900 });
    expect(body).toEqual({ ok: true, service: 'api', version: 'abc123', uptimeSec: 62 });
    expect(HealthResponse.safeParse(body).success).toBe(true);
  });

  it('never reports negative uptime when the clock steps back', () => {
    expect(healthResponse({ service: 'api', version: 'v', startedAtMs: 5_000, nowMs: 1_000 }).uptimeSec).toBe(0);
  });

  it('includes optional service details', () => {
    expect(
      healthResponse({
        service: 'api',
        version: 'v',
        startedAtMs: 0,
        nowMs: 1000,
        details: { command_decisions: { ok: false } },
      }).details,
    ).toEqual({ command_decisions: { ok: false } });
  });

  it('refuses an empty service name', () => {
    expect(() => healthResponse({ service: '', version: 'v', startedAtMs: 0, nowMs: 0 })).toThrow();
  });
});
