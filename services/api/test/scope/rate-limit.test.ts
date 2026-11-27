import { describe, expect, it } from 'vitest';
import { allowScopeStart } from '../../src/scope/rate-limit.js';
import { makeDeps } from '../helpers.js';

describe('scope start rate limit', () => {
  it('bounds repeated scope starts per user without affecting another user', () => {
    const deps = makeDeps();
    for (let i = 0; i < 10; i += 1) expect(allowScopeStart(deps, 'creator')).toBe(true);
    expect(allowScopeStart(deps, 'creator')).toBe(false);
    expect(allowScopeStart(deps, 'another')).toBe(true);
  });
});
