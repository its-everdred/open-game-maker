import { AiurConfigError, AiurHttpError, AiurUnavailableError } from './errors.js';
import {
  CancelResultSchema,
  CommandScopeSchema,
  ControlResultSchema,
  DecisionMutationSchema,
  DecisionPageSchema,
  DecisionSchema,
  EventPageSchema,
  EventsTokenSchema,
  IssueEntrySchema,
  MessageResultSchema,
  SpendCapSchema,
  StateSchema,
  TicketProgressSchema,
  TicketUsageSchema,
  UsageAccountsSchema,
  parseContract,
  type CancelResult,
  type AiurState,
  type Decision,
  type EventPage,
  type IssueEntry,
  type SpendCap,
  type TicketProgress,
  type TicketUsage,
  type UsageAccounts,
} from './schemas.js';

export type AiurDaemon = {
  baseUrl: string;
  token: string;
  supervisorToken?: string;
};

type DecisionReasoning = {
  expected_version: number;
  idempotency_key: string;
  rationale: string;
  confidence?: number;
  alternatives_considered?: string[];
  reversibility_belief?: 'reversible' | 'partially_reversible' | 'irreversible';
};

export type DecisionQuery = {
  ticket?: string;
  kind?: string;
  blocking?: boolean;
  authority?: string;
  limit?: number;
  cursor?: string;
};

// An answer takes either one option or free text, and a review deck's answer carries both: the option it picks and the
// whole like/dislike map as JSON text in `custom_response`. aiur's decision record keeps the two beside each other
// (`option_id` and `custom_response` on one answer object), so a caller may send them together.
export type DecisionAnswer = DecisionReasoning &
  ({ option: string; response?: string } | { option?: never; response: string });

// A creator's own answer to a Command, sent as the creator rather than as the supervising agent: aiur refuses a
// supervisor answer to a decision only a human may take (403 on `decide`). One of `option` or `response` (aiur calls
// both together ambiguous); a review deck's like/dislike map is the `response`.
export type CreatorAnswer = {
  // The Command's ticket, which the short-lived grant is scoped to, and who the creator is in OGM.
  ticket: string;
  principal: string;
  expected_version: number;
  idempotency_key: string;
  rationale?: string;
} & ({ option: string; response?: never } | { option?: never; response: string });

// One Command media file as aiur serves it. `body` is the response stream; the caller must read or cancel it. The
// request's `signal` also aborts the body read, so a stalled transfer ends when it fires.
export type DecisionMediaFile = { mime: string; body: ReadableStream<Uint8Array> };

export interface AiurClient {
  readonly baseUrl: string;
  state(signal?: AbortSignal): Promise<AiurState>;
  issue(id: string): Promise<IssueEntry>;
  usage(id: string): Promise<TicketUsage>;
  progress(id: string, limit?: number, signal?: AbortSignal): Promise<TicketProgress>;
  setSpendCap(id: string, usd: string): Promise<SpendCap>;
  cancel(id: string): Promise<CancelResult>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  message(
    id: string,
    text: string,
    messageId?: string,
    signal?: AbortSignal,
  ): Promise<{ request_id: string; warning?: 'outcome_unknown' }>;
  nudgeTodo(ids: string[]): Promise<void>;
  accounts(): Promise<UsageAccounts>;
  events(after: number, limit: number, patterns: string[]): Promise<EventPage>;
  eventsToken(): Promise<{ token: string; expires_in_seconds: number }>;
  decisions(query?: DecisionQuery, signal?: AbortSignal): Promise<Decision[]>;
  decision(id: string): Promise<Decision>;
  decide(id: string, answer: DecisionAnswer): Promise<Decision>;
  answerAsCreator(id: string, answer: CreatorAnswer): Promise<void>;
  decisionMedia(id: string, attachmentId: string, signal?: AbortSignal): Promise<DecisionMediaFile>;
  healthz(): Promise<boolean>;
}

export type AiurClientOptions = {
  messageRetryDelayMs?: number;
};

type RequestOptions = {
  body?: unknown;
  write?: boolean;
  supervisor?: boolean;
  // A Command scope grant to send instead of the daemon's own tokens.
  bearer?: string;
  allowStatuses?: number[];
  signal?: AbortSignal;
  // Leave a successful response's body unread so the caller can stream it.
  raw?: boolean;
};

const ISSUE_ID = /^[1-9][0-9]{0,18}$/;
const USD = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;

export function createAiurClient(
  daemon: AiurDaemon,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: AiurClientOptions = {},
): AiurClient {
  const baseUrl = daemon.baseUrl.replace(/\/$/, '');
  const retryDelay = options.messageRetryDelayMs ?? 1000;

  async function fetchResponse(
    method: string,
    path: string,
    request: RequestOptions = {},
  ): Promise<{ response: Response; body: unknown }> {
    const token = request.bearer ?? (request.supervisor ? daemon.supervisorToken : daemon.token);
    if (!token) throw new AiurConfigError('A supervisor token is required for Decision API calls');

    const headers = new Headers({ authorization: `Bearer ${token}`, accept: 'application/json' });
    if (request.body !== undefined) headers.set('content-type', 'application/json');
    if (request.write) {
      headers.set('origin', baseUrl);
      headers.set('x-aiur-request', '1');
    }

    let response: Response;
    let body: unknown;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: request.signal,
      });
      body = request.raw && response.ok ? undefined : await responseBody(response);
    } catch (cause) {
      throw new AiurUnavailableError(baseUrl, cause);
    }

    if (!response.ok && !request.allowStatuses?.includes(response.status)) {
      throw httpError(response.status, body, baseUrl);
    }
    return { response, body };
  }

  async function writeWithoutResult(path: string): Promise<void> {
    await fetchResponse('POST', path, { write: true });
  }

  async function sendMessage(id: string, text: string, messageId?: string, signal?: AbortSignal, retry = false) {
    const body = messageId ? { text, message_id: messageId } : { text };
    const result = await fetchResponse('POST', `/api/v1/${encodeURIComponent(id)}/messages`, {
      body,
      write: true,
      signal,
    });
    const parsed = MessageResultSchema.parse(result.body);
    if (parsed.outcome === 'unknown' && messageId && !retry) {
      await sleep(retryDelay);
      return sendMessage(id, text, messageId, signal, true);
    }
    return {
      request_id: parsed.request_id ?? '',
      ...(parsed.outcome === 'unknown' ? { warning: 'outcome_unknown' as const } : {}),
    };
  }

  return {
    baseUrl,
    async state(signal) {
      const { body } = await fetchResponse('GET', '/api/v1/state', { signal });
      return parseContract(StateSchema, body);
    },
    async issue(id) {
      const { body } = await fetchResponse('GET', `/api/v1/${encodeURIComponent(id)}`);
      return parseContract(IssueEntrySchema, body);
    },
    async usage(id) {
      const { body } = await fetchResponse('GET', `/api/v1/${encodeURIComponent(id)}/usage`);
      return parseContract(TicketUsageSchema, body);
    },
    async progress(id, limit, signal) {
      const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`;
      const { body } = await fetchResponse('GET', `/api/v1/${encodeURIComponent(id)}/progress${query}`, { signal });
      return parseContract(TicketProgressSchema, body);
    },
    async setSpendCap(id, usd) {
      if (!USD.test(usd) || Number(usd) <= 0)
        throw new TypeError('USD amount must be a positive decimal string with at most 6 fraction digits');
      const { body } = await fetchResponse('PUT', `/api/v1/${encodeURIComponent(id)}/spend-cap`, {
        body: { amount: usd, currency: 'USD' },
        write: true,
      });
      return parseContract(SpendCapSchema, body);
    },
    async cancel(id) {
      const { body, response } = await fetchResponse('POST', `/api/v1/${encodeURIComponent(id)}/cancel`, {
        write: true,
        allowStatuses: [409],
      });
      const parsed = CancelResultSchema.safeParse(body);
      if (parsed.success) return parsed.data;
      if (!response.ok) throw httpError(response.status, body, baseUrl);
      return CancelResultSchema.parse(body);
    },
    pause: (id) => writeWithoutResult(`/api/v1/${encodeURIComponent(id)}/pause`),
    resume: (id) => writeWithoutResult(`/api/v1/${encodeURIComponent(id)}/resume`),
    message: (id, text, messageId, signal) => sendMessage(id, text, messageId, signal),
    async nudgeTodo(ids) {
      if (ids.length === 0 || ids.some((id) => !ISSUE_ID.test(id)))
        throw new TypeError('Invalid issue identifier in todo list');
      const expression = `todo([${ids.map((id) => JSON.stringify(id)).join(',')}], only: true)`;
      const { body } = await fetchResponse('POST', '/api/v1/control', {
        body: {
          contract: 'aiur.control.call',
          contract_version: 1,
          expression,
          max_scope: 'write',
        },
        write: true,
      });
      parseContract(ControlResultSchema, body);
    },
    async accounts() {
      const { body } = await fetchResponse('GET', '/api/v1/usage/accounts');
      return parseContract(UsageAccountsSchema, body);
    },
    async events(after, limit, patterns) {
      const query = new URLSearchParams({ after: String(after), limit: String(limit), topics: patterns.join(',') });
      const { body } = await fetchResponse('GET', `/api/v1/events?${query.toString()}`);
      return EventPageSchema.parse(body);
    },
    async eventsToken() {
      const { body } = await fetchResponse('POST', '/api/v1/events/token', { write: true });
      return EventsTokenSchema.parse(body);
    },
    async decisions(query = {}, signal) {
      const params = new URLSearchParams();
      if (query.ticket !== undefined) params.set('ticket', query.ticket);
      if (query.kind !== undefined) params.set('kind', query.kind);
      if (query.blocking !== undefined) params.set('blocking', String(query.blocking));
      if (query.authority !== undefined) params.set('authority', query.authority);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.cursor !== undefined) params.set('cursor', query.cursor);
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      const { body } = await fetchResponse('GET', `/api/v1/decisions${suffix}`, {
        supervisor: true,
        write: true,
        signal,
      });
      return DecisionPageSchema.parse(body).decisions;
    },
    async decision(id) {
      const { body } = await fetchResponse('GET', `/api/v1/decisions/${encodeURIComponent(id)}`, {
        supervisor: true,
        write: true,
      });
      return DecisionSchema.parse(body);
    },
    async decide(id, answer) {
      const { option, response, ...reasoning } = answer;
      const { body } = await fetchResponse('POST', `/api/v1/decisions/${encodeURIComponent(id)}/decide`, {
        body: {
          ...reasoning,
          ...(option === undefined ? {} : { option_id: option }),
          ...(response === undefined ? {} : { custom_response: response }),
        },
        write: true,
        supervisor: true,
      });
      return DecisionMutationSchema.parse(body).decision;
    },
    // The creator answers through aiur's Commands host API: the supervisor credential mints a one-minute grant for the
    // Command's ticket, and the answer goes out under that grant, so aiur records it as the creator's own.
    async answerAsCreator(id, { ticket, principal, option, response, ...answer }) {
      const { body } = await fetchResponse('POST', '/api/v1/commands/scope', {
        body: { principal, tickets: [ticket], expires_in: 60 },
        write: true,
        supervisor: true,
      });
      const { token } = CommandScopeSchema.parse(body);
      await fetchResponse('POST', `/api/v1/commands/${encodeURIComponent(id)}/answer`, {
        body: {
          ...answer,
          ...(option === undefined ? {} : { option_id: option }),
          ...(response === undefined ? {} : { custom_response: response }),
        },
        write: true,
        bearer: token,
      });
    },
    async decisionMedia(id, attachmentId, signal) {
      const { response } = await fetchResponse(
        'GET',
        `/api/v1/decisions/${encodeURIComponent(id)}/media/${encodeURIComponent(attachmentId)}`,
        { supervisor: true, write: true, raw: true, signal },
      );
      if (response.body === null) throw new AiurUnavailableError(baseUrl, new Error('empty media response'));
      return { mime: response.headers.get('content-type') ?? 'application/octet-stream', body: response.body };
    },
    async healthz() {
      try {
        const response = await fetchImpl(`${baseUrl}/healthz`);
        return response.ok;
      } catch (cause) {
        throw new AiurUnavailableError(baseUrl, cause);
      }
    },
  };
}

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function httpError(status: number, body: unknown, daemon: string): AiurHttpError {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const rawError = record.error;
  const error = typeof rawError === 'object' && rawError !== null ? (rawError as Record<string, unknown>) : {};
  const code = typeof error.code === 'string' ? error.code : typeof rawError === 'string' ? rawError : `http_${status}`;
  const message = typeof error.message === 'string' ? error.message : `Aiur request failed with HTTP ${status}`;
  return new AiurHttpError(status, code, message, daemon);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
