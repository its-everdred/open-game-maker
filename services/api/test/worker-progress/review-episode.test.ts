import { expect, it, vi } from 'vitest';
import { createReviewEpisodeReader } from '../../src/worker-progress/review-episode.js';

it('finds the latest matching label event across pages', async () => {
  const events = Array.from({ length: 100 }, (_, id) => ({ id, event: 'commented' }));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(events)))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: 101, event: 'labeled', label: { name: 'agent:human-review' }, created_at: '2026-01-01T00:00:00Z' },
          { id: 102, event: 'labeled', label: { name: 'agent:human-review' }, created_at: '2026-01-02T00:00:00Z' },
        ]),
      ),
    );
  expect(
    await createReviewEpisodeReader('test', fetcher)({ owner: 'owner', name: 'repo' }, '42', ['agent:human-review']),
  ).toBe('102@2026-01-02T00:00:00Z');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('fails closed when history cannot be read', async () => {
  const reader = createReviewEpisodeReader('test', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(reader({ owner: 'owner', name: 'repo' }, '42', ['agent:human-review'])).rejects.toThrow(
    'Review episode unavailable',
  );
});

it('returns no active episode after a review label is removed', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify([
        { id: 1, event: 'labeled', label: { name: 'agent:human-review' }, created_at: '2026-01-01T00:00:00Z' },
        { id: 2, event: 'unlabeled', label: { name: 'agent:human-review' }, created_at: '2026-01-02T00:00:00Z' },
      ]),
    ),
  );
  expect(
    await createReviewEpisodeReader('test', fetcher)({ owner: 'owner', name: 'repo' }, '42', ['agent:human-review']),
  ).toBeNull();
});
