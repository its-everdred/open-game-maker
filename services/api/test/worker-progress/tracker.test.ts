import { describe, expect, it, vi } from 'vitest';
import { createTrackerReader } from '../../src/worker-progress/tracker.js';
import { belongsToGame } from '../../src/worker-progress/scope.js';

describe('tracker snapshot', () => {
  it('coalesces simultaneous reads and scopes labels and legacy job tickets', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { number: 1, title: 'Mine', labels: [{ name: 'game:old-name' }] },
          { number: 2, title: 'Legacy job', labels: [] },
          { number: 3, title: 'Other game', labels: [{ name: 'game:other' }] },
          { number: 4, title: 'PR', pull_request: {} },
        ]),
      ),
    );
    const read = createTrackerReader('token', fetcher);
    const repo = { owner: 'owner', name: 'shared' };
    const [tickets, second] = await Promise.all([read(repo, 'open'), read(repo, 'open')]);
    expect(second).toEqual(tickets);
    expect(fetcher).toHaveBeenCalledOnce();
    const scope = { slugs: new Set(['new-name', 'old-name']), owned: new Map([['2', 'job']]) };
    expect(tickets.tickets.filter((ticket) => belongsToGame(ticket, scope)).map((ticket) => ticket.ticket)).toEqual([
      '1',
      '2',
    ]);
  });
  it('marks the last snapshot stale after an expired refresh fails', async () => {
    let now = 1;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response('', { status: 429 }));
    try {
      const read = createTrackerReader('token', fetcher);
      const repo = { owner: 'owner', name: 'shared' };
      expect(await read(repo, 'open')).toEqual({ tickets: [], stale: false });
      now += 60_001;
      expect(await read(repo, 'open')).toEqual({ tickets: [], stale: true });
      expect(await read(repo, 'open')).toEqual({ tickets: [], stale: true });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
});
