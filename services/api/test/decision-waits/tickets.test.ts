import { describe, expect, it } from 'vitest';

import { createWaitTickets, GitHubError } from '../../src/decision-waits/tickets.js';

type Call = { method: string; url: string; body?: unknown };

function fakeFetch(answer: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call = {
      method: init.method ?? 'GET',
      url,
      ...(init.body ? { body: JSON.parse(init.body as string) as unknown } : {}),
    };
    calls.push(call);
    const { status, body } = answer(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('wait tickets on GitHub', () => {
  it('pages through labels and keeps only wait keys', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ name: `other-${index}` }));
    const { impl, calls } = fakeFetch(({ url }) =>
      url.endsWith('&page=1')
        ? { status: 200, body: [...first.slice(0, 99), { name: 'waits:blobs/diorama' }] }
        : { status: 200, body: [{ name: 'waits:dec_00000000000000aa' }, { name: 'agent:paused' }] },
    );
    const keys = await createWaitTickets('t', impl).keys('acme/games');
    expect(keys).toEqual(['blobs/diorama', 'dec_00000000000000aa']);
    expect(calls).toHaveLength(2);
  });

  it('lists the labelled issues of every state with their comments, skipping pull requests', async () => {
    const { impl, calls } = fakeFetch(({ url }) => {
      if (url.includes('/issues?')) {
        return {
          status: 200,
          body: [
            { number: 7, state: 'closed', labels: [{ name: 'waits:blobs/diorama' }] },
            { number: 8, state: 'open', labels: [], pull_request: {} },
          ],
        };
      }
      return { status: 200, body: [{ body: 'one' }, { body: null }] };
    });
    const tickets = await createWaitTickets('t', impl).waiting('acme/games', 'blobs/diorama');
    expect(tickets).toEqual([{ number: 7, open: false, labels: ['waits:blobs/diorama'], comments: ['one', ''] }]);
    expect(calls[0]!.url).toContain('state=all&labels=waits%3Ablobs%2Fdiorama');
  });

  it('closes as not planned, reopens, and treats an already deleted label as done', async () => {
    const { impl, calls } = fakeFetch(({ method }) =>
      method === 'DELETE' ? { status: 404 } : { status: 200, body: {} },
    );
    const tickets = createWaitTickets('t', impl);
    await tickets.setOpen('acme/games', 7, false);
    await tickets.setOpen('acme/games', 7, true);
    await tickets.deleteLabel('acme/games', 'blobs/diorama');
    expect(calls.map(({ method, body }) => [method, body])).toEqual([
      ['PATCH', { state: 'closed', state_reason: 'not_planned' }],
      ['PATCH', { state: 'open' }],
      ['DELETE', undefined],
    ]);
    expect(calls[2]!.url).toMatch(/\/labels\/waits%3Ablobs%2Fdiorama$/);
  });

  it('fails a write GitHub refuses, so the release is retried', async () => {
    const { impl } = fakeFetch(() => ({ status: 403 }));
    await expect(createWaitTickets('t', impl).comment('acme/games', 7, 'x')).rejects.toBeInstanceOf(GitHubError);
  });
});
