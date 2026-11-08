import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AiurConfigError, createAiurClient, type AiurClient, type Decision } from '@ogm/aiur-client';
import type { AgentOutboxLine } from '@ogm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getChatRuntime } from '../../src/build-chat/routes.js';
import { registerWorkspace } from '../../src/build-chat/outbox-relay.js';
import { insertChatRow, listSince, parseCheckpoint } from '../../src/build-chat/store.js';
import { checkpointBudget } from '../../src/checkpoints/budget.js';
import { statusOf } from '../../src/checkpoints/correlate.js';
import { createInboxWriter } from '../../src/checkpoints/inbox.js';
import { handle as handleCheckpoint } from '../../src/checkpoints/outbox.js';
import { createCheckpointPoller } from '../../src/checkpoints/poller.js';
import { as, chatJob, jobTable, JOB_ID, makeChatApp, makeChatDeps, OTHER_JOB_ID } from '../build-chat/setup.js';

const CP_ID = 'cp_01JBX2R1A2B3C4D5E6F7G8H9JK';
const LINE_ID = '01JBX2R1A2B3C4D5E6F7G8H9JK';
const DECISION_ID = 'decision-1';
const json = { 'content-type': 'application/json' };

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    decision_id: DECISION_ID,
    version: 2,
    ticket: { identifier: '142' },
    kind: 'direction_checkpoint',
    authority: 'supervisor_allowed',
    blocking: true,
    reversibility: 'reversible',
    question: 'Which door?',
    options: [
      { id: 'wood', label: 'Wooden' },
      { id: 'iron', label: 'Iron' },
    ],
    recommendation: { option_id: 'iron', reason: 'Fits the castle' },
    context: { long_context_markdown: `<!-- gm-checkpoint:${CP_ID} -->` },
    created_at: '2026-11-01T09:15:00Z',
    decision_status: 'open',
    ...overrides,
  } as Decision;
}

function checkpointLine(overrides: Record<string, unknown> = {}): AgentOutboxLine {
  return {
    v: 1,
    id: LINE_ID,
    job_id: JOB_ID,
    at: '2026-11-01T09:15:00Z',
    type: 'checkpoint.open',
    payload: {
      checkpoint_id: CP_ID,
      question: 'Which door?',
      options: [
        { id: 'wood', label: 'Wooden' },
        { id: 'iron', label: 'Iron' },
      ],
      recommend: 'iron',
      blocking: true,
      ...overrides,
    },
  };
}

function insertOpenCheckpoint(deps: ReturnType<typeof makeChatDeps>, linked = true): void {
  insertChatRow(deps.sqlite, {
    id: LINE_ID,
    jobId: JOB_ID,
    actor: 'agent',
    kind: 'checkpoint',
    text: 'Which door?',
    checkpoint: {
      checkpoint_id: CP_ID,
      decision_id: linked ? DECISION_ID : '',
      version: linked ? 2 : undefined,
      question: 'Which door?',
      options: [
        { id: 'wood', label: 'Wooden' },
        { id: 'iron', label: 'Iron' },
      ],
      recommend: 'iron',
      blocking: true,
      status: 'open',
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('checkpoint outbox and budget', () => {
  it('stores an open checkpoint, retaining only media rows from the same job', async () => {
    const deps = makeChatDeps();
    const validMedia = insertChatRow(deps.sqlite, {
      jobId: JOB_ID,
      actor: 'agent',
      kind: 'image',
      text: 'wood preview',
    }).row!;
    const otherMedia = insertChatRow(deps.sqlite, {
      jobId: OTHER_JOB_ID,
      actor: 'agent',
      kind: 'image',
      text: 'other job preview',
    }).row!;
    const publish = vi.fn();

    await handleCheckpoint(
      checkpointLine({
        options: [
          { id: 'wood', label: 'Wooden', media_id: validMedia.id },
          { id: 'iron', label: 'Iron', media_id: otherMedia.id },
        ],
      }),
      {
        jobId: JOB_ID,
        workspaceRoot: mkdtempSync(join(tmpdir(), 'ogm-checkpoint-outbox-')),
        sqlite: deps.sqlite,
        blobStore: deps.blobStore,
        publish,
        log: deps.log,
      },
    );

    const row = listSince(deps.sqlite, JOB_ID, 0).find(({ kind }) => kind === 'checkpoint')!;
    expect(parseCheckpoint(row)).toMatchObject({
      checkpoint_id: CP_ID,
      decision_id: '',
      status: 'open',
      options: [{ id: 'wood', media_id: validMedia.id }, { id: 'iron' }],
    });
    expect(publish).toHaveBeenCalledWith(JOB_ID);
    expect(checkpointBudget(deps.sqlite, JOB_ID, 'new_game')).toEqual({ used: 1, max: 3 });
  });

  // A playable option (#608) is played in the card, so its slice survives storage even when a stray media id is dropped.
  it('keeps each option’s playable slice, including one whose media was rejected', async () => {
    const deps = makeChatDeps();
    const otherMedia = insertChatRow(deps.sqlite, { jobId: OTHER_JOB_ID, actor: 'agent', kind: 'image' }).row!;
    const slow = { scenario: 'scenario=sandbox&speed=slow', seconds: 8, lead_in: 'one-chain' };
    const fast = { scenario: 'scenario=sandbox&speed=fast', seconds: 5 };

    await handleCheckpoint(
      checkpointLine({
        options: [
          { id: 'wood', label: 'Slow', playable: slow },
          { id: 'iron', label: 'Fast', media_id: otherMedia.id, playable: fast },
        ],
      }),
      {
        jobId: JOB_ID,
        workspaceRoot: mkdtempSync(join(tmpdir(), 'ogm-checkpoint-outbox-')),
        sqlite: deps.sqlite,
        blobStore: deps.blobStore,
        publish: vi.fn(),
        log: deps.log,
      },
    );

    const row = listSince(deps.sqlite, JOB_ID, 0).find(({ kind }) => kind === 'checkpoint')!;
    expect(parseCheckpoint(row)?.options).toEqual([
      { id: 'wood', label: 'Slow', playable: slow },
      { id: 'iron', label: 'Fast', playable: fast },
    ]);
  });
});

describe('checkpoint poller', () => {
  it('keeps unknown future decision statuses open', () => {
    expect(statusOf(decision({ decision_status: 'waiting_for_future_route' }))).toBe('open');
  });

  it('links marker Commands, mirrors supported native questions, and marks missing open Commands moot', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ogm-checkpoint-poller-'));
    const deps = makeChatDeps();
    registerWorkspace(deps.sqlite, JOB_ID, workspace);
    insertOpenCheckpoint(deps, false);
    const native = decision({
      decision_id: 'native-1',
      kind: 'native_question',
      question: 'Which path?',
      questions: [{ question: 'Which path?', multi_select: false }],
      context: {},
      blocking: false,
    });
    const unrelated = decision({
      decision_id: 'unrelated-1',
      kind: null,
      question: 'Free-form observation?',
      options: [],
      context: {},
    });
    const multiSelect = decision({
      decision_id: 'multi-select-1',
      kind: 'native_question',
      question: 'Which paths?',
      questions: [{ multi_select: true }],
      context: {},
    });
    const decisions = vi
      .fn()
      .mockResolvedValueOnce([decision(), native, unrelated, multiSelect])
      .mockResolvedValueOnce([]);
    const client = { decisions } as unknown as AiurClient;
    deps.registry.aiurClientFor = () => client;
    const publish = vi.fn();
    const poller = createCheckpointPoller({
      sqlite: deps.sqlite,
      jobs: () => deps.registry.chatJobs,
      clientFor: () => deps.registry.aiurClientFor,
      inbox: createInboxWriter({ sqlite: deps.sqlite, log: deps.log }),
      publish,
      log: deps.log,
    });

    await poller.tick();
    let checkpoints = listSince(deps.sqlite, JOB_ID, 0).filter(({ kind }) => kind === 'checkpoint');
    expect(checkpoints.map(parseCheckpoint)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkpoint_id: CP_ID, decision_id: DECISION_ID, version: 2 }),
        expect.objectContaining({ decision_id: 'native-1', question: 'Which path?', status: 'open' }),
      ]),
    );
    expect(decisions).toHaveBeenCalledWith({ ticket: '142', limit: 50 });
    expect(checkpoints.map(parseCheckpoint)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decision_id: 'unrelated-1' }),
        expect.objectContaining({ decision_id: 'multi-select-1' }),
      ]),
    );

    await poller.tick();
    checkpoints = listSince(deps.sqlite, JOB_ID, 0).filter(({ kind }) => kind === 'checkpoint');
    expect(checkpoints.map(parseCheckpoint)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decision_id: DECISION_ID, status: 'moot' }),
        expect.objectContaining({ decision_id: 'native-1', status: 'moot' }),
      ]),
    );
    expect(JSON.parse(readFileSync(join(workspace, '.gm/inbox/checkpoints', `${CP_ID}.json`), 'utf8'))).toMatchObject({
      checkpoint_id: CP_ID,
      decision_id: DECISION_ID,
      status: 'moot',
    });
    expect(publish).toHaveBeenCalled();
  });

  it('logs one outage per failure streak, reports a missing supervisor token, and changes no cards', async () => {
    const deps = makeChatDeps();
    insertOpenCheckpoint(deps, false);
    deps.registry.aiurClientFor = () =>
      ({
        decisions: vi.fn().mockRejectedValue(new AiurConfigError('missing supervisor token')),
      }) as unknown as AiurClient;
    const supervisorTokenStatus = vi.fn();
    const poller = createCheckpointPoller({
      sqlite: deps.sqlite,
      jobs: () => deps.registry.chatJobs,
      clientFor: () => deps.registry.aiurClientFor,
      inbox: createInboxWriter({ sqlite: deps.sqlite, log: deps.log }),
      publish: vi.fn(),
      log: deps.log,
      supervisorTokenStatus,
    });

    await poller.tick();
    await poller.tick();

    expect(deps.lines.filter(({ event }) => event === 'checkpoint-poll-error')).toHaveLength(1);
    expect(supervisorTokenStatus).toHaveBeenCalledWith('game-1', true);
    expect(parseCheckpoint(listSince(deps.sqlite, JOB_ID, 0)[0]!)).toMatchObject({ decision_id: '', status: 'open' });
  });

  it('retries a terminal inbox write before changing the card state', async () => {
    const deps = makeChatDeps();
    insertOpenCheckpoint(deps);
    const terminal = decision({ decision_status: 'decided', answer: { selected_option_id: 'wood' } });
    deps.registry.aiurClientFor = () => ({ decisions: vi.fn().mockResolvedValue([terminal]) }) as unknown as AiurClient;
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(true);
    const poller = createCheckpointPoller({
      sqlite: deps.sqlite,
      jobs: () => deps.registry.chatJobs,
      clientFor: () => deps.registry.aiurClientFor,
      inbox: { write },
      publish: vi.fn(),
      log: deps.log,
    });

    await poller.tick();
    expect(parseCheckpoint(listSince(deps.sqlite, JOB_ID, 0)[0]!)).toMatchObject({ status: 'open' });

    await poller.tick();
    expect(parseCheckpoint(listSince(deps.sqlite, JOB_ID, 0).at(-1)!)).toMatchObject({
      status: 'answered',
      option_id: 'wood',
    });
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe('checkpoint routes and inbox', () => {
  it('answers once with the listed version, updates the card, and writes both inbox names', async () => {
    const requests: { url: string; headers: Headers; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return new Response(
        JSON.stringify({ status: 'accepted', decision: decision({ answer: { selected_option_id: 'iron' } }) }),
        {
          status: 202,
          headers: json,
        },
      );
    });
    const client = createAiurClient(
      { baseUrl: 'http://127.0.0.1:4101', token: 'client-token', supervisorToken: 'supervisor-token' },
      fetchImpl,
    );
    const jobs = jobTable(chatJob({ kind: 'new_game' }));
    const { app, deps } = await makeChatApp(jobs, client);
    const workspace = mkdtempSync(join(tmpdir(), 'ogm-checkpoint-answer-'));
    registerWorkspace(deps.sqlite, JOB_ID, workspace);
    insertOpenCheckpoint(deps);

    const response = await app.request(`/api/v1/jobs/${JOB_ID}/checkpoints/${CP_ID}/answer`, {
      method: 'POST',
      headers: { ...json, ...as('owner') },
      body: JSON.stringify({ option_id: 'iron' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'answered', decision_id: DECISION_ID, option_id: 'iron' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `http://127.0.0.1:4101/api/v1/decisions/${DECISION_ID}/decide`,
      body: {
        option_id: 'iron',
        expected_version: 2,
        idempotency_key: `ogm:player:${CP_ID}:2`,
        rationale: "Creator chose 'Iron' in the build chat",
      },
    });
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer supervisor-token');
    expect(requests[0]!.headers.get('x-aiur-request')).toBe('1');
    expect(parseCheckpoint(listSince(deps.sqlite, JOB_ID, 0).at(-1)!)).toMatchObject({
      status: 'answered',
      option_id: 'iron',
    });
    for (const name of [CP_ID, DECISION_ID]) {
      expect(JSON.parse(readFileSync(join(workspace, '.gm/inbox/checkpoints', `${name}.json`), 'utf8'))).toMatchObject({
        checkpoint_id: CP_ID,
        decision_id: DECISION_ID,
        option_id: 'iron',
        status: 'answered',
      });
    }
    expect(getChatRuntime(deps)).toBeDefined();
  });

  it('refreshes a 409 winner without making a second decide request', async () => {
    const methods: string[] = [];
    const winner = decision({ decision_status: 'decided', answer: { selected_option_id: 'wood' } });
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      if (init?.method === 'POST') return new Response(JSON.stringify({ error: 'decision_conflict' }), { status: 409 });
      return new Response(JSON.stringify(winner), { status: 200, headers: json });
    });
    const client = createAiurClient(
      { baseUrl: 'http://127.0.0.1:4101', token: 'client-token', supervisorToken: 'supervisor-token' },
      fetchImpl,
    );
    const { app, deps } = await makeChatApp(jobTable(chatJob()), client);
    insertOpenCheckpoint(deps);

    const response = await app.request(`/api/v1/jobs/${JOB_ID}/checkpoints/${CP_ID}/answer`, {
      method: 'POST',
      headers: { ...json, ...as('owner') },
      body: JSON.stringify({ option_id: 'iron' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'answered', by: 'other' });
    expect(methods).toEqual(['POST', 'GET']);
    expect(parseCheckpoint(listSince(deps.sqlite, JOB_ID, 0).at(-1)!)).toMatchObject({
      status: 'answered',
      option_id: 'wood',
    });
  });

  it('keeps a checkpoint open when a stale-version conflict refreshes to a newer open version', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ error: 'decision_conflict' }), { status: 409 });
      return new Response(JSON.stringify(decision({ version: 3 })), { status: 200, headers: json });
    });
    const client = createAiurClient(
      { baseUrl: 'http://127.0.0.1:4101', token: 'client-token', supervisorToken: 'supervisor-token' },
      fetchImpl,
    );
    const { app, deps } = await makeChatApp(jobTable(chatJob()), client);
    insertOpenCheckpoint(deps);

    const response = await app.request(`/api/v1/jobs/${JOB_ID}/checkpoints/${CP_ID}/answer`, {
      method: 'POST',
      headers: { ...json, ...as('owner') },
      body: JSON.stringify({ option_id: 'iron' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'open', by: 'other' });
    expect(parseCheckpoint(listSince(deps.sqlite, JOB_ID, 0).at(-1)!)).toMatchObject({ status: 'open', version: 3 });
    expect(deps.lines).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'checkpoint-inbox-workspace-missing' })]),
    );
  });

  it('returns not_linked, enforces creator ownership, and reports the job budget', async () => {
    const { app, deps } = await makeChatApp(jobTable(chatJob({ kind: 'new_game' })));
    insertOpenCheckpoint(deps, false);
    insertChatRow(deps.sqlite, {
      jobId: JOB_ID,
      actor: 'agent',
      kind: 'checkpoint',
      checkpoint: {
        checkpoint_id: 'native-2',
        decision_id: 'native-2',
        version: 1,
        question: 'Another?',
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        status: 'answered',
        option_id: 'yes',
      },
    });

    const unlinked = await app.request(`/api/v1/jobs/${JOB_ID}/checkpoints/${CP_ID}/answer`, {
      method: 'POST',
      headers: { ...json, ...as('owner') },
      body: JSON.stringify({ option_id: 'iron' }),
    });
    expect(unlinked.status).toBe(425);
    expect(await unlinked.json()).toEqual({ status: 'not_linked' });
    expect(
      (
        await app.request(`/api/v1/jobs/${JOB_ID}/checkpoints/${CP_ID}/answer`, {
          method: 'POST',
          headers: { ...json, ...as('player') },
          body: JSON.stringify({ option_id: 'iron' }),
        })
      ).status,
    ).toBe(403);

    const budget = await app.request(`/api/v1/jobs/${JOB_ID}/checkpoints/budget`, { headers: as('owner') });
    expect(await budget.json()).toEqual({ used: 2, max: 3 });
  });
});
