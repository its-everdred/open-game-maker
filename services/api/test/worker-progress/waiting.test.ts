import { describe, expect, it, vi } from 'vitest';
import { createWaitingTicketReader } from '../../src/worker-progress/waiting.js';

describe('waiting ticket reader', () => {
  it('returns only unambiguous waiting tickets for the requested game', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { number: 1, title: 'Checks', labels: [{ name: 'game:forest' }, { name: 'agent:ci-wait' }] },
          { number: 2, title: 'Another game', labels: [{ name: 'game:other' }, { name: 'agent:human-review' }] },
          {
            number: 3,
            title: 'Ambiguous',
            labels: [{ name: 'game:forest' }, { name: 'agent:ci-wait' }, { name: 'agent:merging' }],
          },
          { number: 4, title: 'PR', pull_request: {}, labels: [{ name: 'game:forest' }, { name: 'agent:ci-wait' }] },
        ]),
      ),
    );
    const read = createWaitingTicketReader('token', fetcher);
    expect(await read('forest', { owner: 'owner', name: 'shared' })).toEqual([
      { ticket: '1', title: 'Checks', state: 'ci-wait' },
    ]);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('labels=game%3Aforest');
  });
});
