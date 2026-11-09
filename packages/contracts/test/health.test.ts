import { describe, expect, it } from 'vitest';

import { HealthResponse } from '../src/health.js';
import { loadJson } from './helpers.js';

describe('health contract', () => {
  it('accepts the golden fixture', () => {
    expect(HealthResponse.parse(loadJson('fixtures/health.v1.json'))).toEqual({
      ok: true,
      service: 'api',
      version: '9508c1c',
      uptimeSec: 12,
    });
  });

  it('rejects negative uptime', () => {
    expect(() => HealthResponse.parse({ ok: true, service: 'api', version: '1', uptimeSec: -1 })).toThrow();
  });

  it('accepts optional service health details', () => {
    expect(
      HealthResponse.parse({
        ok: true,
        service: 'api',
        version: '1',
        uptimeSec: 1,
        details: { command_decisions: { ok: false } },
      }).details,
    ).toEqual({ command_decisions: { ok: false } });
  });
});
