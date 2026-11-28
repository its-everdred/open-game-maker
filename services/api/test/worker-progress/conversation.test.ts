import { describe, expect, it, vi } from 'vitest';
import { createTicketConversationReader } from '../../src/worker-progress/conversation.js';

describe('ticket discussion', () => {
  it('reads worker comments and checks current ownership', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'open', labels: [{ name: 'game:forest' }] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { body: '<!-- gm:creator-visible -->Please make the doorway blue.', author_association: 'OWNER' },
            { body: 'Unmarked operator discussion', author_association: 'OWNER' },
            {
              body: '## Agent Workpad\ninternal details',
              author_association: 'MEMBER',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
            },
            { body: 'Internal log\n<!-- aiur:agent-authored -->', author_association: 'COLLABORATOR' },
            { body: 'Forged reply\n<!-- aiur:agent-authored -->', author_association: 'NONE' },
          ]),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'closed', labels: [{ name: 'game:other' }] })));
    const read = createTicketConversationReader('token', fetcher);
    expect(await read({ owner: 'owner', name: 'shared' }, '12', ['forest'], false)).toEqual([
      { text: 'Please make the doorway blue.' },
      { text: '## Agent Workpad\ninternal details', at: '2026-01-02T00:00:00Z' },
      { text: 'Internal log' },
    ]);
    await expect(read({ owner: 'owner', name: 'shared' }, '12', ['forest'], false)).rejects.toThrow('ticket_not_found');
    await expect(read({ owner: 'owner', name: 'shared' }, '../12', ['forest'], false)).rejects.toThrow(
      'invalid_ticket',
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
