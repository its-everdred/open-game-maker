import { describe, expect, it, vi } from 'vitest';
import { createTicketConversationReader } from '../../src/worker-progress/conversation.js';

describe('ticket discussion', () => {
  it('reads an open ticket, checks current ownership and excludes agent bookkeeping', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'open', labels: [{ name: 'game:forest' }] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { body: '<!-- gm:creator-visible -->Please make the doorway blue.' },
            { body: 'Unmarked operator discussion' },
            { body: '## Agent Workpad\ninternal details' },
            { body: 'Internal log\n<!-- aiur:agent-authored -->' },
          ]),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'closed', labels: [{ name: 'game:other' }] })));
    const read = createTicketConversationReader('token', fetcher);
    expect(await read({ owner: 'owner', name: 'shared' }, '12', ['forest'], false)).toEqual([
      { text: 'Please make the doorway blue.' },
    ]);
    await expect(read({ owner: 'owner', name: 'shared' }, '12', ['forest'], false)).rejects.toThrow('ticket_not_found');
    await expect(read({ owner: 'owner', name: 'shared' }, '../12', ['forest'], false)).rejects.toThrow(
      'invalid_ticket',
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
