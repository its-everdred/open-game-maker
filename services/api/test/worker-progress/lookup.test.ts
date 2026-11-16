import { describe, expect, it, vi } from 'vitest';
import { createTicketLookup } from '../../src/worker-progress/lookup.js';

describe('new ticket lookup', () => {
  it('coalesces reads and retains the authoritative game labels', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ state: 'open', title: 'A live ticket', labels: [{ name: 'game:forest' }] })),
      );
    const read = createTicketLookup('token', fetcher);
    const repo = { owner: 'owner', name: 'shared' };
    const [first, second] = await Promise.all([read(repo, '12'), read(repo, '12')]);
    expect(first).toMatchObject({ ticket: '12', labels: ['game:forest'] });
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('treats a missing ticket as absent rather than a feed failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const read = createTicketLookup('token', fetcher);
    const repo = { owner: 'owner', name: 'shared' };
    expect(await read(repo, '15')).toBeNull();
    expect(await read(repo, '15')).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
