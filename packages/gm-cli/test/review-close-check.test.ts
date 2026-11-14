import { afterEach, expect, it, vi } from 'vitest';
import { gm } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

it('fails closed until the operator API says the ticket may close', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ allowed: false }))
    .mockResolvedValueOnce(Response.json({ allowed: true }))
    .mockResolvedValueOnce(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const args = ['review', 'close-check', 'lantern-bay', '42', 'a'.repeat(40)];
  const env = { OGM_INTERNAL_TOKEN: 'test-token-long-enough', OGM_API_PORT: '4300' };
  const blocked = await gm(args, { env });
  expect(blocked.code, blocked.err.join(' ')).toBe(1);
  expect((await gm(args, { env })).code).toBe(0);
  expect((await gm(args, { env })).code).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});
