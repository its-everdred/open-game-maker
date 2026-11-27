import { describe, expect, it, vi } from 'vitest';

import { fetchBuildJson, loadFactor } from '../src/qa-play-fetch.js';

describe('published build fetch', () => {
  it('retries a publish race until the build is served', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Game' }), { status: 200 }));
    const sleep = vi.fn(async (_ms: number) => {});
    expect(
      await fetchBuildJson(new URL('https://games.example/g/game/build/manifest.json'), { fetcher, sleep }),
    ).toEqual({ value: { title: 'Game' } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('reports the actual final HTTP status when retries fail', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const result = await fetchBuildJson(new URL('https://games.example/manifest.json'), {
      fetcher,
      sleep: async () => {},
    });
    expect(result.error).toContain('HTTP 503');
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('reports a response body timeout as a timeout, not invalid JSON', async () => {
    const response = {
      ok: true,
      json: async () => {
        throw new DOMException('body timed out', 'TimeoutError');
      },
    } as Response;
    const result = await fetchBuildJson(new URL('https://games.example/manifest.json'), {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response),
      sleep: async () => {},
    });
    expect(result.error).toContain('TimeoutError: body timed out');
    expect(result.error).not.toContain('invalid JSON');
  });

  it('scales busy-host time within a hard cap', () => {
    expect(loadFactor(2, 8)).toBe(1);
    expect(loadFactor(12, 8)).toBe(1.5);
    expect(loadFactor(80, 8)).toBe(2);
  });
});
