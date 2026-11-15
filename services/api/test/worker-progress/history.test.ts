import { describe, expect, it, vi } from 'vitest';
import { createTicketHistoryReader } from '../../src/worker-progress/history.js';

describe('ticket history', () => {
  it('returns all closed issues in close order, excludes pull requests and keeps cancellation outcomes', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      title: `Ticket ${index + 1}`,
      closed_at: '2026-01-01',
      state_reason: 'completed',
      labels: [{ name: 'game:forest' }],
    }));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(first)))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              number: 101,
              title: 'Cancelled',
              closed_at: '2026-02-01',
              state_reason: 'not_planned',
              labels: [{ name: 'game:forest' }],
            },
            { number: 102, title: 'PR', closed_at: '2026-03-01', pull_request: {}, labels: [{ name: 'game:forest' }] },
            { number: 103, title: 'Other game', closed_at: '2026-03-01', labels: [{ name: 'game:other' }] },
            {
              number: 104,
              title: 'Ambiguous',
              closed_at: '2026-03-01',
              labels: [{ name: 'game:forest' }, { name: 'game:other' }],
            },
          ]),
        ),
      );
    const read = createTicketHistoryReader({ owner: 'owner', name: 'game' }, 'token', fetcher);
    const result = await read('forest');
    expect(result).toHaveLength(101);
    expect(result[0]).toEqual({
      ticket: '101',
      title: 'Cancelled',
      outcome: 'Cancelled',
      closedAt: '2026-02-01',
      url: 'https://github.com/owner/game/issues/101',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('labels=game%3Aforest');
    await read('forest');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
