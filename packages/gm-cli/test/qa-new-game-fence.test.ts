import { describe, expect, it, vi } from 'vitest';
import { QaCreateFenceClient } from '../src/qa-new-game-fence.js';

describe('commit-service QA fence client', () => {
  it('holds and releases the exact game fence through the authenticated internal endpoint', async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === 'DELETE'
              ? { released: true }
              : init?.method === 'POST'
                ? { ready: true }
                : { terminal: true },
          ),
          { status: 200 },
        ),
    );
    const fence = new QaCreateFenceClient('http://127.0.0.1:4301', 'secret', fetcher);
    await fence.acquire('g_123', 'run-1');
    expect(await fence.terminal('g_123')).toBe(true);
    await fence.release('g_123', 'run-1');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'x-ogm-internal': 'secret' },
      body: '{"owner":"run-1"}',
    });
    await expect(fence.acquire('bad/id', 'run-1')).rejects.toThrow(/invalid/);
  });
});
