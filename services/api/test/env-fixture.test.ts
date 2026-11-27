import { describe, expect, it } from 'vitest';

import { loadApiEnv } from '../src/app/env.js';
import { makeApiEnv } from './env-fixture.js';

describe('makeApiEnv', () => {
  it('derives a complete valid environment from apiEnvSpec', () => {
    expect(() => loadApiEnv(makeApiEnv())).not.toThrow();
  });
});

it('accepts only a loopback core daemon URL and leaves missing core settings unset', () => {
  expect(loadApiEnv(makeApiEnv()).AIUR_API_URL).toBeUndefined();
  expect(
    loadApiEnv(makeApiEnv({ AIUR_API_URL: 'http://127.0.0.1:4999', AIUR_API_TOKEN: 'test-token-0123456789' }))
      .AIUR_API_URL,
  ).toBe('http://127.0.0.1:4999');
  expect(() =>
    loadApiEnv(makeApiEnv({ AIUR_API_URL: 'https://example.test', AIUR_API_TOKEN: 'test-token-0123456789' })),
  ).toThrow(/AIUR_API_URL/);
});

it('distinguishes an explicitly configured daily allowance from the built-in default', () => {
  expect(loadApiEnv(makeApiEnv()).defaultDailyAllowanceConfigured).toBe(false);
  expect(loadApiEnv(makeApiEnv({ OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD: '' })).defaultDailyAllowanceConfigured).toBe(
    false,
  );
  expect(
    loadApiEnv(makeApiEnv({ OGM_DEFAULT_DAILY_ALLOWANCE_MICROUSD: '5000000' })).defaultDailyAllowanceConfigured,
  ).toBe(true);
});
