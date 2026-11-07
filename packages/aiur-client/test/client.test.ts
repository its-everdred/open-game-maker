import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { AiurConfigError, AiurHttpError, AiurUnavailableError, createAiurClient } from '../src/index.js';

const daemon = {
  baseUrl: 'http://127.0.0.1:4000',
  token: 'client-secret',
  supervisorToken: 'supervisor-secret',
};

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const decision = {
  decision_id: 'decision-1',
  version: 2,
  ticket: { identifier: '142' },
  kind: 'architecture',
  authority: 'supervisor_allowed',
  blocking: true,
  reversibility: 'reversible',
  question: 'Ship?',
  options: [{ id: 'approve', label: 'Approve' }],
  created_at: '2026-10-31T18:00:00Z',
  decision_status: 'pending',
};

describe('createAiurClient', () => {
  it('sends the spend-cap write with the required method, path, headers, and body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        contract: 'aiur.ticket_spend_cap',
        contract_version: 1,
        schema_version: 1,
        job_id: '142',
        ticket: { owner: 'its-everdred', repository: 'game', identifier: '142' },
        currency: 'USD',
        cap_amount: '12.50',
        spent_amount: '0',
        remaining_amount: '12.50',
        state: 'active',
        end_state: null,
        coverage: {},
        authority: {},
        configured_at: '2026-10-31T18:00:00Z',
        reached_at: null,
        effects: {},
      }),
    );
    const client = createAiurClient(daemon, fetchImpl);

    await client.setSpendCap('142', '12.50');

    const [url, init] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(url).toBe('http://127.0.0.1:4000/api/v1/142/spend-cap');
    expect(init?.method).toBe('PUT');
    expect(headers.get('authorization')).toBe('Bearer client-secret');
    expect(headers.get('origin')).toBe(daemon.baseUrl);
    expect(headers.get('x-aiur-request')).toBe('1');
    expect(JSON.parse(String(init?.body))).toEqual({ amount: '12.50', currency: 'USD' });
  });

  it('returns a 409 cancellation body instead of throwing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture('cancel-409'), 409));

    await expect(createAiurClient(daemon, fetchImpl).cancel('142')).resolves.toEqual(fixture('cancel-409'));
  });

  it('keeps non-process cancellation conflicts as typed HTTP errors', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'agent_not_running', message: 'Agent is not currently running' } }, 409),
      );

    await expect(createAiurClient(daemon, fetchImpl).cancel('142')).rejects.toMatchObject({
      status: 409,
      code: 'agent_not_running',
    });
  });

  it('retries an outcome-unknown message once with the same message id', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ outcome: 'unknown', request_id: 'msg-1', retry_safe: true }, 202))
      .mockResolvedValueOnce(jsonResponse(fixture('message'), 202));
    const client = createAiurClient(daemon, fetchImpl, { messageRetryDelayMs: 0 });

    await expect(client.message('142', 'hello', 'stable-id')).resolves.toEqual({ request_id: 'msg-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { text: 'hello', message_id: 'stable-id' },
      { text: 'hello', message_id: 'stable-id' },
    ]);
  });

  it('does not retry an outcome-unknown message without an idempotency id', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ outcome: 'unknown', request_id: 'msg-1', retry_safe: false }, 202));

    await expect(createAiurClient(daemon, fetchImpl).message('142', 'hello')).resolves.toEqual({
      request_id: 'msg-1',
      warning: 'outcome_unknown',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('passes a caller timeout signal to message requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture('message'), 202));
    const signal = AbortSignal.timeout(1000);

    await createAiurClient(daemon, fetchImpl).message('142', 'hello', 'stable-id', signal);

    expect(fetchImpl.mock.calls[0]![1]?.signal).toBe(signal);
  });

  it('builds the exact allowlisted control expression and validates ids locally', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture('control')));
    const client = createAiurClient(daemon, fetchImpl);

    await client.nudgeTodo(['12', '142']);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      contract: 'aiur.control.call',
      contract_version: 1,
      expression: 'todo(["12","142"], only: true)',
      max_scope: 'write',
    });

    await expect(client.nudgeTodo(['abc'])).rejects.toThrow('Invalid issue identifier');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('uses the supervisor token for decision calls and requires it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ decisions: [] }));
    await createAiurClient(daemon, fetchImpl).decisions({ ticket: '142', limit: 50 });
    const headers = new Headers(fetchImpl.mock.calls[0]![1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer supervisor-secret');
    expect(headers.get('origin')).toBe(daemon.baseUrl);
    expect(headers.get('x-aiur-request')).toBe('1');
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:4000/api/v1/decisions?ticket=142&limit=50');

    const withoutSupervisor = createAiurClient({ baseUrl: daemon.baseUrl, token: daemon.token }, fetchImpl);
    await expect(withoutSupervisor.decision('decision-1')).rejects.toBeInstanceOf(AiurConfigError);
  });

  it('parses the canonical public decision answer shape and nullable metadata', async () => {
    const canonical = {
      ...decision,
      kind: null,
      options: [{ id: 'approve', label: 'Approve', description: null }],
      recommendation: { option_id: null, reason: null },
      context: { short_summary: 'Ship?', long_context_markdown: null },
      questions: [{ question: 'Ship?', options: [{ id: 'approve', label: 'Approve' }] }],
      answer: { selected_option_id: 'approve', custom_response: null },
      active_answer: { selected_option_id: 'approve', custom_response: null },
      decision_status: 'answered',
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(canonical));

    await expect(createAiurClient(daemon, fetchImpl).decision('decision-1')).resolves.toMatchObject(canonical);
  });

  it('sends the minimal reversible decision answer required by a checkpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'accepted', decision }, 202));

    await createAiurClient(daemon, fetchImpl).decide('decision-1', {
      option: 'approve',
      expected_version: 2,
      idempotency_key: 'ogm:cp_1:2',
      rationale: "Creator chose 'Approve' in the build chat",
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({
      option_id: 'approve',
      expected_version: 2,
      idempotency_key: 'ogm:cp_1:2',
      rationale: "Creator chose 'Approve' in the build chat",
    });
  });

  it('sends a review answer’s option and its like/dislike map together', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'accepted', decision }, 202));
    const map = JSON.stringify({ kind: 'question_answers', answers: [{ option_id: 'v2', verdict: 'like' }] });

    await createAiurClient(daemon, fetchImpl).decide('decision-1', {
      option: 'v2',
      response: map,
      expected_version: 2,
      idempotency_key: 'ogm:player:cp_1:2',
      rationale: "Creator chose 'Voice 2' in the build chat. Reviewed the deck: liked Voice 2; disliked nothing",
    });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toMatchObject({
      option_id: 'v2',
      custom_response: map,
      expected_version: 2,
      idempotency_key: 'ogm:player:cp_1:2',
    });
  });

  it('uses a comma-separated topics query for event pages', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture('events-page')));

    await createAiurClient(daemon, fetchImpl).events(10, 100, ['ticket.142.#', 'ticket.143.#']);

    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'http://127.0.0.1:4000/api/v1/events?after=10&limit=100&topics=ticket.142.%23%2Cticket.143.%23',
    );
  });

  it('covers every read, control, extension, and health route', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(fixture('issue')))
      .mockResolvedValueOnce(jsonResponse(fixture('usage')))
      .mockResolvedValueOnce(jsonResponse(fixture('progress')))
      .mockResolvedValueOnce(jsonResponse({ action: 'pause' }, 202))
      .mockResolvedValueOnce(jsonResponse({ action: 'resume' }, 202))
      .mockResolvedValueOnce(jsonResponse(fixture('cancel-exited')))
      .mockResolvedValueOnce(jsonResponse(fixture('accounts')))
      .mockResolvedValueOnce(jsonResponse(fixture('events-page')))
      .mockResolvedValueOnce(jsonResponse({ token: 'short-lived', expires_in_seconds: 300 }))
      .mockResolvedValueOnce(jsonResponse({ decisions: [] }))
      .mockResolvedValueOnce(jsonResponse(decision))
      .mockResolvedValueOnce(jsonResponse({ status: 'accepted', decision }, 202))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const client = createAiurClient(daemon, fetchImpl);

    await client.issue('142');
    await client.usage('142');
    await client.progress('142', 7);
    await client.pause('142');
    await client.resume('142');
    await client.cancel('142');
    await client.accounts();
    await client.events(10, 20, ['ticket.142.#']);
    await client.eventsToken();
    await client.decisions();
    await client.decision('decision-1');
    await client.decide('decision-1', {
      option: 'approve',
      expected_version: 2,
      idempotency_key: 'answer-1',
      rationale: 'The checks passed',
      confidence: 95,
      alternatives_considered: ['wait'],
      reversibility_belief: 'reversible',
    });
    await expect(client.healthz()).resolves.toBe(true);

    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      [`${daemon.baseUrl}/api/v1/142`, 'GET'],
      [`${daemon.baseUrl}/api/v1/142/usage`, 'GET'],
      [`${daemon.baseUrl}/api/v1/142/progress?limit=7`, 'GET'],
      [`${daemon.baseUrl}/api/v1/142/pause`, 'POST'],
      [`${daemon.baseUrl}/api/v1/142/resume`, 'POST'],
      [`${daemon.baseUrl}/api/v1/142/cancel`, 'POST'],
      [`${daemon.baseUrl}/api/v1/usage/accounts`, 'GET'],
      [`${daemon.baseUrl}/api/v1/events?after=10&limit=20&topics=ticket.142.%23`, 'GET'],
      [`${daemon.baseUrl}/api/v1/events/token`, 'POST'],
      [`${daemon.baseUrl}/api/v1/decisions`, 'GET'],
      [`${daemon.baseUrl}/api/v1/decisions/decision-1`, 'GET'],
      [`${daemon.baseUrl}/api/v1/decisions/decision-1/decide`, 'POST'],
      [`${daemon.baseUrl}/healthz`, 'GET'],
    ]);

    for (const index of [3, 4, 5, 8, 11]) {
      const headers = new Headers(fetchImpl.mock.calls[index]![1]?.headers);
      expect(headers.get('origin')).toBe(daemon.baseUrl);
      expect(headers.get('x-aiur-request')).toBe('1');
    }
    expect(new Headers(fetchImpl.mock.calls[11]![1]?.headers).get('authorization')).toBe('Bearer supervisor-secret');
    expect(JSON.parse(String(fetchImpl.mock.calls[11]![1]?.body))).toEqual({
      option_id: 'approve',
      expected_version: 2,
      idempotency_key: 'answer-1',
      rationale: 'The checks passed',
      confidence: 95,
      alternatives_considered: ['wait'],
      reversibility_belief: 'reversible',
    });
  });

  it('throws typed HTTP errors with aiur status and code', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: { code: 'usage_unavailable', message: 'Usage unavailable' } }, 503));

    const promise = createAiurClient(daemon, fetchImpl).usage('142');
    await expect(promise).rejects.toBeInstanceOf(AiurHttpError);
    await expect(promise).rejects.toMatchObject({ status: 503, code: 'usage_unavailable' });
  });

  it('wraps fetch failures without exposing the token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(createAiurClient(daemon, fetchImpl).issue('142')).rejects.toBeInstanceOf(AiurUnavailableError);
    await expect(createAiurClient(daemon, fetchImpl).issue('142')).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining(daemon.token),
    );
  });

  it('wraps response-body transport failures as unavailable', async () => {
    const response = new Response('{}');
    vi.spyOn(response, 'text').mockRejectedValue(new Error('socket closed'));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(createAiurClient(daemon, fetchImpl).issue('142')).rejects.toBeInstanceOf(AiurUnavailableError);
  });
});
