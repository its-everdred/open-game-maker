import { describe, expect, it, vi } from 'vitest';

import { gm } from './helpers.js';

describe('gm admin games prune-failed', () => {
  it('lists audited candidates by default and removes them only when dry-run is disabled', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.endsWith('/prune-failed-candidates'))
        return Response.json({ games: [{ id: 'g_failed', title: 'Broken', createdAt: '2026-11-20' }] });
      return Response.json({ removed: true });
    });
    try {
      const dryRun = await gm(['admin', 'games', 'prune-failed', '--dry-run', '--api', 'http://127.0.0.1:4300'], {
        env: { OGM_INTERNAL_TOKEN: 'test-token' },
      });
      expect(dryRun).toMatchObject({ code: 0, out: ['g_failed\tBroken\t2026-11-20'] });
      expect(calls.map(({ method }) => method)).toEqual(['GET']);

      calls.length = 0;
      const prune = await gm(['admin', 'games', 'prune-failed', '--prune', '--api', 'http://127.0.0.1:4300'], {
        env: { OGM_INTERNAL_TOKEN: 'test-token' },
      });
      expect(prune).toMatchObject({ code: 0, out: ['g_failed\tremoved'] });
      expect(calls.map(({ method }) => method)).toEqual(['GET', 'DELETE']);
    } finally {
      fetcher.mockRestore();
    }
  });

  it('refuses to send the internal token to a non-loopback API origin', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      const result = await gm(['admin', 'games', 'prune-failed', '--api', 'https://example.com'], {
        env: { OGM_INTERNAL_TOKEN: 'test-token' },
      });
      expect(result.code).toBe(2);
      expect(result.err.join('\n')).toContain('loopback HTTP origin');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
});
