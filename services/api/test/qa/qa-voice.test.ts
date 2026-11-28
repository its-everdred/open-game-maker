import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { QA_VOICE_ISSUE, QA_VOICE_TITLE } from '../../src/qa/voice.js';
import { sweepExpiredDrafts } from '../../src/game-drafts/cleanup.js';
import { readQaState } from '../../src/qa/state.js';
import { INTERNAL_TOKEN, makeApp, makeDeps } from '../helpers.js';

const QA_EMAIL = 'qa@example.test';
const VOICE_SECRET = 'ogm-test-voice-secret-0123456789abcdef';

// The prod voice E2E (#879) tests build and New Game chat on QA-owned, dispatchless fixtures. The QA creator must get
// real voice tokens, stored turns must read back, and fixture cleanup must leave nothing.
async function voiceApp() {
  const deps = makeDeps();
  Object.assign(deps.config, {
    voiceTokenSecret: VOICE_SECRET,
    voiceInternalSecret: VOICE_SECRET,
    voiceWsUrl: 'wss://voice.example.test/ws/voice',
  });
  const { app } = await makeApp(deps);
  const internal = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-ogm-internal': INTERNAL_TOKEN, ...init.headers },
    });
  const session = (await (
    await internal('/internal/qa/session', { method: 'POST', body: JSON.stringify({ email: QA_EMAIL }) })
  ).json()) as { userId: string; gameId: string; cookie: { name: string; value: string } };
  const asQa = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${session.cookie.name}=${session.cookie.value}` },
      body: JSON.stringify(body),
    });
  return { app, deps, internal, session, asQa };
}

describe('QA voice fixtures (#879)', () => {
  it.each([
    ['POST', '/internal/qa/voice-fixtures'],
    ['GET', '/internal/qa/voice-fixtures/run-1'],
    ['DELETE', '/internal/qa/voice-fixtures/run-1'],
    ['DELETE', '/internal/qa/voice-fixtures'],
  ])('refuses %s %s without the internal token', async (method, path) => {
    const { app, session } = await voiceApp();
    const response = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', cookie: `${session.cookie.name}=${session.cookie.value}` },
      ...(method === 'POST' ? { body: JSON.stringify({ run: 'run-1' }) } : {}),
    });
    expect(response.status).toBe(401);
  });

  it('seeds dispatchless build and New Game chats for QA dictation and voice', async () => {
    const { deps, internal, session, asQa } = await voiceApp();
    const seeded = await internal('/internal/qa/voice-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'run-1' }),
    });
    expect(seeded.status).toBe(201);
    const { jobId, title, draftId } = (await seeded.json()) as { jobId: string; title: string; draftId: string };
    expect(title).toBe(QA_VOICE_TITLE);

    // A build that never takes a job slot or reaches a daemon: released, filed, on a ticket no real repository has.
    const job = deps.db.select().from(schema.jobs).all();
    expect(job).toEqual([
      expect.objectContaining({ id: jobId, gameId: session.gameId, creatorId: session.userId, state: 'filed' }),
    ]);
    expect(job[0]!.releasedAt).not.toBeNull();
    expect(deps.db.select().from(schema.gameDrafts).all()).toEqual([
      expect.objectContaining({ id: draftId, creatorId: session.userId, ticketRepo: 'qa', ticketNumber: 879 }),
    ]);

    const target = {
      kind: 'build',
      game_id: session.gameId,
      job_id: jobId,
      ticket: String(QA_VOICE_ISSUE),
      creator_id: session.userId,
    };
    for (const path of ['/api/v1/voice/dictation-token', '/api/v1/voice/token']) {
      const response = await asQa(path, { target });
      expect(response.status, path).toBe(200);
    }

    const scopeTarget = { kind: 'scope', game_id: draftId, session_id: draftId, creator_id: session.userId };
    expect((await asQa('/api/v1/voice/dictation-token', { target: scopeTarget })).status).toBe(200);

    // The voice host stores each final turn in that chat; the report reads them back for the E2E.
    const stored = await internal('/internal/voice/transcript', {
      method: 'POST',
      headers: { 'x-ogm-internal': VOICE_SECRET },
      body: JSON.stringify({ target, conversation_id: 'c-1', turn_id: 't-1', actor: 'creator', text: 'Hello' }),
    });
    expect(stored.status).toBe(200);
    const report = (await (await internal('/internal/qa/voice-fixtures/run-1')).json()) as {
      messages: { actor: string; text: string }[];
    };
    expect(report.messages).toEqual([expect.objectContaining({ actor: 'creator', text: 'Hello' })]);
    const scopeTranscript = await internal('/internal/voice/transcript', {
      method: 'POST',
      headers: { 'x-ogm-internal': VOICE_SECRET },
      body: JSON.stringify({
        target: scopeTarget,
        conversation_id: 'c-scope',
        turn_id: 't-scope',
        actor: 'creator',
        text: 'Make the sky blue',
      }),
    });
    expect(scopeTranscript.status).toBe(200);
    const withScope = (await (await internal('/internal/qa/voice-fixtures/run-1')).json()) as {
      draftMessages: { actor: string; text: string }[];
    };
    expect(withScope.draftMessages).toEqual([expect.objectContaining({ actor: 'creator', text: 'Make the sky blue' })]);
    expect((await internal('/internal/qa/voice-fixtures/run-1', { method: 'DELETE' })).status).toBe(200);
    expect(deps.db.select().from(schema.gameDrafts).all()).toEqual([]);
  });

  it('replaces a dead run’s fixtures and deletes their chats', async () => {
    const { deps, internal, asQa } = await voiceApp();
    await internal('/internal/qa/voice-fixtures', { method: 'POST', body: JSON.stringify({ run: 'dead-run' }) });
    const next = await internal('/internal/qa/voice-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'run-2' }),
    });
    expect(next.status).toBe(201);
    expect(deps.db.select({ id: schema.jobs.id }).from(schema.jobs).all()).toEqual([{ id: 'j_qa-voice-run-2' }]);
    expect(deps.db.select().from(schema.gameDrafts).all()).toHaveLength(1);
    const currentDraftId = readQaState(deps.db)!.voiceDraftId!;
    expect((await internal('/internal/qa/voice-fixtures/dead-run', { method: 'DELETE' })).status).toBe(200);
    expect(deps.db.select({ id: schema.gameDrafts.id }).from(schema.gameDrafts).all()).toEqual([
      { id: currentDraftId },
    ]);
    const currentScopeTarget = {
      kind: 'scope',
      game_id: currentDraftId,
      session_id: currentDraftId,
      creator_id: readQaState(deps.db)!.userId,
    };
    expect((await internal('/internal/qa/voice-fixtures/run-2')).status).toBe(200);
    expect((await asQa('/api/v1/voice/dictation-token', { target: currentScopeTarget })).status).toBe(200);

    // Any other job on the QA game (not a voice fixture) survives every voice delete, including delete-all.
    const at = new Date().toISOString();
    const qaGame = deps.db.select().from(schema.jobs).get()!;
    deps.db
      .insert(schema.jobs)
      .values({ ...qaGame, id: 'j-other', aiurRepo: 'owner/game', aiurIssueNumber: 7, createdAt: at, updatedAt: at })
      .run();
    expect((await internal('/internal/qa/voice-fixtures', { method: 'DELETE' })).status).toBe(200);
    expect(deps.db.select().from(schema.gameDrafts).all()).toEqual([]);
    expect(deps.db.select({ id: schema.jobs.id }).from(schema.jobs).all()).toEqual([{ id: 'j-other' }]);
    await internal('/internal/qa/voice-fixtures', { method: 'POST', body: JSON.stringify({ run: 'run-2' }) });
    deps.sqlite
      .prepare(`INSERT INTO build_chat_messages (id, job_id, at, actor, kind, text) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('m-1', 'j_qa-voice-run-2', new Date().toISOString(), 'creator', 'text', 'Hello');
    const deleted = await internal('/internal/qa/voice-fixtures/run-2', { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(deps.db.select().from(schema.gameDrafts).all()).toEqual([]);
    expect(deps.db.select({ id: schema.jobs.id }).from(schema.jobs).all()).toEqual([{ id: 'j-other' }]);
    expect(deps.db.select().from(schema.buildChatMessages).all()).toEqual([]);
    expect((await internal('/internal/qa/voice-fixtures/run-2')).status).toBe(404);
  });

  it('expires the New Game QA draft without closing its shared voice issue', async () => {
    const { deps, internal } = await voiceApp();
    const seeded = await internal('/internal/qa/voice-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'expiry-test' }),
    });
    const { draftId } = (await seeded.json()) as { draftId: string };
    const close = vi.fn(async () => undefined);
    deps.registry.draftScopeAssistant = {
      create: async () => ({ repo: 'qa', ticket: String(QA_VOICE_ISSUE) }),
      close,
      transcript: async () => [],
    };
    deps.sqlite.prepare('UPDATE game_drafts SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', draftId);

    await sweepExpiredDrafts(deps, new Date('2026-11-28T00:00:00.000Z'));

    expect(close).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.gameDrafts).all()).toEqual([]);
    expect(readQaState(deps.db)?.voiceDraftId).toBeUndefined();
  });
});
