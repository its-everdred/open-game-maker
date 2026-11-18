import { afterEach, expect, it, vi } from 'vitest';
import { recordPlay } from './recordPlay';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('retries a failed play record', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const recording = recordPlay('game');
  await vi.advanceTimersByTimeAsync(500);
  await recording;
  expect(fetch).toHaveBeenCalledTimes(2);
  const firstId = new Headers(fetch.mock.calls[0]?.[1]?.headers).get('x-ogm-play-id');
  expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
  expect(firstId).toBe(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('x-ogm-play-id'));
});

it('does not retry an older play after leaving the game', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const recording = recordPlay('game', controller.signal);
  const result = expect(recording).rejects.toThrow('offline');
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(500);
  await result;
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('allows an in-flight play record to finish after leaving', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn((...args: [RequestInfo | URL, RequestInit?]) => {
    void args;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const recording = recordPlay('game', controller.signal);
  await Promise.resolve();
  controller.abort();
  finish(new Response('{}'));
  await expect(recording).resolves.toBeUndefined();
  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
});

it('records overlapping plays in their opening order', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const first = recordPlay('b');
  const second = recordPlay('a');
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(new Response('{}'));
  await Promise.all([first, second]);
  expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/api/v1/games/b/play', '/api/v1/games/a/play']);
});
