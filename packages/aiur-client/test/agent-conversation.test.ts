import { describe, expect, it, vi } from 'vitest';

import { AiurContractError, createAiurClient } from '../src/index.js';

const daemon = { baseUrl: 'http://127.0.0.1:4000', token: 'secret' };
const request = { text: 'Fix the door', owner: 'user-1', path: 'games/example', client_request_id: 'conv-1' };
const result = {
  conversation_id: 'conv-1',
  ticket: '42',
  url: 'https://github.com/example/game/issues/42',
  created: true,
  thread: '/api/v1/42/thread',
  messages: '/api/v1/42/messages',
};

describe('on-demand conversations', () => {
  it('starts a conversation with an idempotency key and authenticated write headers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result, { status: 201 }));
    await expect(createAiurClient(daemon, fetchImpl).startAgentConversation(request)).resolves.toEqual(result);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${daemon.baseUrl}/api/v1/agent-conversations`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('x-aiur-request')).toBe('1');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it('rejects a malformed response instead of treating it as a started worker', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...result, ticket: null }));
    await expect(createAiurClient(daemon, fetchImpl).startAgentConversation(request)).rejects.toBeInstanceOf(
      AiurContractError,
    );
  });

  it('does not forward unexpected diagnostic fields into the public issue', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result));
    const input = { ...request, logs: 'private' };
    await createAiurClient(daemon, fetchImpl).startAgentConversation(input);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).not.toHaveProperty('logs');
  });
});
