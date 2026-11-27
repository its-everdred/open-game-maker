import { createAiurClient } from '@ogm/aiur-client';
import { describe, expect, it, vi } from 'vitest';

import { getChatRuntime } from '../../src/build-chat/routes.js';
import { insertChatRow, listSince } from '../../src/build-chat/store.js';
import { as, chatJob, jobTable, JOB_ID, makeChatApp } from './setup.js';

const url = (path = '') => `/api/v1/jobs/${JOB_ID}/chat${path}`;
const json = { 'content-type': 'application/json' };

type Frame = { id: string; event: string; data: Record<string, unknown> };

// Reads SSE frames one at a time; `close()` cancels the stream.
function sse(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const field = (block: string, name: string) => new RegExp(`^${name}: ?(.*)$`, 'm').exec(block)?.[1] ?? '';
  return {
    async next(): Promise<Frame> {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (block.startsWith(':')) continue;
          return {
            id: field(block, 'id'),
            event: field(block, 'event'),
            data: JSON.parse(field(block, 'data')) as Record<string, unknown>,
          };
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buffer += decoder.decode(value, { stream: true });
      }
    },
    close: () => reader.cancel(),
  };
}

async function readFrames(response: Response, count: number): Promise<Frame[]> {
  const stream = sse(response);
  const frames: Frame[] = [];
  try {
    while (frames.length < count) frames.push(await stream.next());
  } finally {
    await stream.close();
  }
  return frames;
}

function recordingAiur() {
  const requests: { url: string; headers: Headers; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as unknown,
    });
    return new Response(JSON.stringify({ request_id: 'req-1' }), { status: 202, headers: json });
  });
  const client = createAiurClient({ baseUrl: 'http://127.0.0.1:4101', token: 'aiur-token-for-tests' }, fetchImpl);
  return { client, requests };
}

describe('build chat routes', () => {
  it('lets an admin read another account’s chat without posting to it', async () => {
    const { app, deps } = await makeChatApp();
    deps.registry.principalResolvers.push(async (c) =>
      c.req.header('x-admin')
        ? {
            kind: 'user',
            userId: 'admin',
            familyId: 'another-family',
            platformRole: 'admin',
            capability: 'creator',
          }
        : null,
    );
    expect((await app.request(`${url()}/messages`, { headers: { 'x-admin': '1' } })).status).toBe(200);
    expect(
      (
        await app.request(url(), {
          method: 'POST',
          headers: { ...json, 'x-admin': '1' },
          body: JSON.stringify({ text: 'hello' }),
        })
      ).status,
    ).toBe(403);
  });
  it('stores a creator post and mirrors it to the job ticket through the aiur client', async () => {
    const aiur = recordingAiur();
    const { app, deps } = await makeChatApp(jobTable(chatJob()), aiur.client);
    const response = await app.request(url(), {
      method: 'POST',
      headers: { ...json, ...as('owner') },
      body: JSON.stringify({ text: 'make the door red' }),
    });
    expect(response.status).toBe(201);
    const message = (await response.json()) as { id: string };
    expect(message).toMatchObject({ job_id: JOB_ID, actor: 'creator', kind: 'text', text: 'make the door red' });

    await vi.waitFor(() => expect(aiur.requests).toHaveLength(1));
    const [request] = aiur.requests;
    expect(request!.url).toBe('http://127.0.0.1:4101/api/v1/142/messages');
    expect(request!.body).toEqual({ text: 'make the door red', message_id: message.id });
    expect(request!.headers.get('origin')).toBe('http://127.0.0.1:4101');
    expect(request!.headers.get('x-aiur-request')).toBe('1');
    await vi.waitFor(() => expect(listSince(deps.sqlite, JOB_ID, 0)[0]?.mirrorState).toBe('sent'));
  });

  it('stores the post even when the job has no ticket yet', async () => {
    const { app, deps } = await makeChatApp(jobTable(chatJob({ aiur: null, state: 'queued' })));
    const response = await app.request(url(), {
      method: 'POST',
      headers: { ...json, ...as('owner') },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(response.status).toBe(201);
    expect(listSince(deps.sqlite, JOB_ID, 0)).toMatchObject([{ text: 'hello', mirrorState: 'pending' }]);
  });

  it.each([
    ['another family member', 'sibling', 403],
    ['a player', 'player', 403],
  ] as const)('refuses %s', async (_label, user, status) => {
    const { app } = await makeChatApp();
    const post = await app.request(url(), {
      method: 'POST',
      headers: { ...json, ...as(user) },
      body: JSON.stringify({ text: 'hi' }),
    });
    expect(post.status).toBe(status);
    expect((await app.request(url('/messages'), { headers: as(user) })).status).toBe(status);
  });

  it('does not let a platform maintainer post as the job creator', async () => {
    const { app } = await makeChatApp();
    const response = await app.request(url(), {
      method: 'POST',
      headers: { ...json, ...as('maintainer') },
      body: JSON.stringify({ text: 'impersonated instruction' }),
    });
    expect(response.status).toBe(403);
  });

  it('returns a stored post without waiting for the aiur request to finish', async () => {
    let finishRequest!: (response: Response) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    );
    const client = createAiurClient({ baseUrl: 'http://127.0.0.1:4101', token: 'aiur-token-for-tests' }, fetchImpl);
    const { app, deps } = await makeChatApp(jobTable(chatJob()), client);

    const response = await app.request(url(), {
      method: 'POST',
      headers: { ...json, ...as('owner') },
      body: JSON.stringify({ text: 'do not block this response' }),
    });
    expect(response.status).toBe(201);
    expect(listSince(deps.sqlite, JOB_ID, 0)[0]?.mirrorState).toBe('pending');

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    finishRequest(new Response(JSON.stringify({ request_id: 'req-1' }), { status: 202, headers: json }));
    await vi.waitFor(() => expect(listSince(deps.sqlite, JOB_ID, 0)[0]?.mirrorState).toBe('sent'));
  });

  it('answers 401 without a session and 404 for an unknown job', async () => {
    const { app } = await makeChatApp(jobTable());
    expect((await app.request(url('/messages'))).status).toBe(401);
    expect((await app.request(url('/messages'), { headers: as('owner') })).status).toBe(404);
  });

  it('rejects empty and oversized text', async () => {
    const { app } = await makeChatApp();
    for (const text of ['   ', 'x'.repeat(8001)]) {
      const response = await app.request(url(), {
        method: 'POST',
        headers: { ...json, ...as('owner') },
        body: JSON.stringify({ text }),
      });
      expect(response.status).toBe(400);
    }
  });

  it('limits a job to 30 creator posts a minute', async () => {
    const { app } = await makeChatApp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const response = await app.request(url(), {
        method: 'POST',
        headers: { ...json, ...as('owner') },
        body: JSON.stringify({ text: `post ${i}` }),
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 30).every((status) => status === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('returns rows after a cursor as JSON with the cursor to pass back', async () => {
    const { app, deps } = await makeChatApp();
    for (const text of ['one', 'two', 'three'])
      insertChatRow(deps.sqlite, { jobId: JOB_ID, actor: 'agent', kind: 'text', text });
    const response = await app.request(url('/messages?since=1'), { headers: as('owner') });
    expect(await response.json()).toMatchObject({
      messages: [{ text: 'two' }, { text: 'three' }],
      last_seq: 3,
    });
  });

  // The panel reconnects with its last seq; it must get only what it missed, then every new row as it lands.
  it('streams rows after since, then live rows, with seq as the event id', async () => {
    const { app, deps } = await makeChatApp();
    for (const text of ['one', 'two', 'three'])
      insertChatRow(deps.sqlite, { jobId: JOB_ID, actor: 'agent', kind: 'text', text });
    const response = await app.request(url('?since=2'), { headers: as('owner') });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = sse(response);
    try {
      expect(await stream.next()).toEqual({
        id: '3',
        event: 'message',
        data: expect.objectContaining({ text: 'three' }),
      });
      insertChatRow(deps.sqlite, { jobId: JOB_ID, actor: 'agent', kind: 'text', text: 'four' });
      getChatRuntime(deps).hub.publish(JOB_ID);
      expect(await stream.next()).toEqual({
        id: '4',
        event: 'message',
        data: expect.objectContaining({ text: 'four' }),
      });
    } finally {
      await stream.close();
    }
  });

  it('resumes a stream from Last-Event-ID', async () => {
    const { app, deps } = await makeChatApp();
    for (const text of ['one', 'two'])
      insertChatRow(deps.sqlite, { jobId: JOB_ID, actor: 'agent', kind: 'text', text });
    const response = await app.request(url(), { headers: { ...as('owner'), 'last-event-id': '1' } });
    expect((await readFrames(response, 1)).map((frame) => frame.data.text)).toEqual(['two']);
  });

  it('shows a creator post on the open stream', async () => {
    const { app } = await makeChatApp(jobTable(chatJob({ aiur: null })));
    const stream = await app.request(url(), { headers: as('owner') });
    const frames = readFrames(stream, 1);
    await app.request(url(), {
      method: 'POST',
      headers: { ...json, ...as('owner') },
      body: JSON.stringify({ text: 'hi' }),
    });
    expect((await frames)[0]).toMatchObject({ id: '1', data: { actor: 'creator', text: 'hi' } });
  });
});
