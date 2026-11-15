import { describe, expect, it } from 'vitest';
import { gameToHostSchema } from '../src/bridge.js';

const request = (pattern: unknown) => ({ v: 1, id: '1', t: 'haptics.pulse', payload: { pattern } });

describe('haptics messages', () => {
  it('accepts strengths and short patterns', () => {
    expect(gameToHostSchema.safeParse(request('heavy')).success).toBe(true);
    expect(gameToHostSchema.safeParse(request([20, 30, 40])).success).toBe(true);
  });
  it('rejects invalid and unbounded patterns', () => {
    for (const pattern of ['loud', [], [101], [-1], [1.5], [1, 1, 1, 1, 1, 1]]) {
      expect(gameToHostSchema.safeParse(request(pattern)).success).toBe(false);
    }
  });
});
