import { describe, expect, it, vi } from 'vitest';

import { AiurHttpError, createAiurClient } from '../src/index.js';

const daemon = { baseUrl: 'http://127.0.0.1:4000', token: 'client-secret', supervisorToken: 'supervisor-secret' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Shapes from aiur#8046 (thread API) and aiur#8034 (uploads and attachments, not shipped yet).
const reply = {
  id: 'pos_12',
  pos: 12,
  request_id: null,
  role: 'executor',
  text: 'On it. Two looks in about 20 minutes.',
  attachments: [{ kind: 'image', mime_type: 'image/png', attachment_id: 'att_1' }],
  created_at: '2026-11-18T05:00:00Z',
  delivery: null,
};

describe('executor thread', () => {
  it('pages the thread after a position and keeps the queued operator messages', async () => {
    const queued = {
      ...reply,
      id: 'req_7',
      pos: null,
      request_id: 7,
      role: 'operator',
      attachments: [],
      delivery: 'queued',
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ messages: [reply], next_after: 12, queued: [queued] }));
    const page = await createAiurClient(daemon, fetchImpl).executorThreadMessages(4, 50);
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:4000/api/v1/executor/thread/messages?after=4&limit=50');
    expect(page.next_after).toBe(12);
    expect(page.messages[0]!.attachments[0]!.attachment_id).toBe('att_1');
    expect(page.queued[0]!.delivery).toBe('queued');
  });

  // aiur refuses a cross-site write without the request marker, and dedupes a retry by `client_request_id`.
  it('sends as a write with the request id and returns the message aiur kept', async () => {
    const sent = { ...reply, id: 'req_9', pos: null, request_id: 9, role: 'operator', delivery: 'queued' };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ message: sent }, 202));
    const message = await createAiurClient(daemon, fetchImpl).sendExecutorThreadMessage({
      text: 'Make Endless the big button',
      client_request_id: 'ogm-1',
      attachments: [{ upload_id: 'up_1', kind: 'screenshot', mime_type: 'image/jpeg' }],
    });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-aiur-request')).toBe('1');
    expect(JSON.parse(String(init.body))).toMatchObject({
      client_request_id: 'ogm-1',
      attachments: [{ upload_id: 'up_1' }],
    });
    expect(message).toMatchObject({ id: 'req_9', delivery: 'queued' });
  });

  it('reports a thread aiur cannot queue to as an HTTP 409', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: 'executor_unavailable', reason: 'read_only' }, 409));
    const error = await createAiurClient(daemon, fetchImpl)
      .sendExecutorThreadMessage({ text: 'hi', client_request_id: 'x' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiurHttpError);
    expect(error).toMatchObject({ status: 409, code: 'executor_unavailable' });
  });

  it('uploads a file as multipart, not JSON', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ upload_id: 'up_1', kind: 'image', mime_type: 'image/png', byte_size: 3 }, 201));
    const upload = await createAiurClient(daemon, fetchImpl).uploadExecutorThreadFile(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      'shot.png',
    );
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect(new Headers(init.headers).get('content-type')).toBeNull();
    expect(upload.upload_id).toBe('up_1');
  });

  it('streams an attachment by its opaque id', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array([7]), { headers: { 'content-type': 'audio/mpeg' } }));
    const file = await createAiurClient(daemon, fetchImpl).executorThreadAttachment('att/1');
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:4000/api/v1/executor/thread/attachments/att%2F1');
    expect(file.mime).toBe('audio/mpeg');
  });
});
