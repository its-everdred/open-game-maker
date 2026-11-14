import { describe, expect, it } from 'vitest';
import { gm } from './helpers.js';

describe('gm check boot', () => {
  it('rejects an invalid viewport', async () => {
    const result = await gm(['check', 'boot', '--viewport', 'wide']);
    expect(result.code).toBe(2);
    expect(result.err.join(' ')).toContain('--viewport must be');
  });
});
