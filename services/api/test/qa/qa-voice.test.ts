import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { QA_VOICE_ISSUE, QA_VOICE_TITLE } from '../../src/qa/voice.js';
import { INTERNAL_TOKEN, makeApp, makeDeps } from '../helpers.js';

const QA_EMAIL = 'qa@example.test';
const VOICE_SECRET = 'ogm-test-voice-secret-0123456789abcdef';

// The prod voice E2E (#879) dictates into, and talks on, a build chat on the QA game. The seeded build must be one the
// QA creator gets real voice tokens for, the voice host's stored turns must read back, and a run must leave nothing.
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

  it('seeds a build whose chat offers the QA creator dictation and a voice session', async () => {
    const { deps, internal, session, asQa } = await voiceApp();
    const seeded = await internal('/internal/qa/voice-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'run-1' }),
    });
    expect(seeded.status).toBe(201);
    const { jobId, title } = (await seeded.json()) as { jobId: string; title: string };
    expect(title).toBe(QA_VOICE_TITLE);

    // A build that never takes a job slot or reaches a daemon: released, filed, on a ticket no real repository has.
    const job = deps.db.select().from(schema.jobs).all();
    expect(job).toEqual([
      expect.objectContaining({ id: jobId, gameId: session.gameId, creatorId: session.userId, state: 'filed' }),
    ]);
    expect(job[0]!.releasedAt).not.toBeNull();

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
  });

  it('replaces a dead run’s build when the next run seeds, and deletes the build and its chat', async () => {
    const { deps, internal } = await voiceApp();
    await internal('/internal/qa/voice-fixtures', { method: 'POST', body: JSON.stringify({ run: 'dead-run' }) });
    const next = await internal('/internal/qa/voice-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'run-2' }),
    });
    expect(next.status).toBe(201);
    expect(deps.db.select({ id: schema.jobs.id }).from(schema.jobs).all()).toEqual([{ id: 'j_qa-voice-run-2' }]);

    deps.sqlite
      .prepare(`INSERT INTO build_chat_messages (id, job_id, at, actor, kind, text) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('m-1', 'j_qa-voice-run-2', new Date().toISOString(), 'creator', 'text', 'Hello');
    const deleted = await internal('/internal/qa/voice-fixtures/run-2', { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(deps.db.select().from(schema.jobs).all()).toEqual([]);
    expect(deps.db.select().from(schema.buildChatMessages).all()).toEqual([]);
    expect((await internal('/internal/qa/voice-fixtures/run-2')).status).toBe(404);
  });
});
