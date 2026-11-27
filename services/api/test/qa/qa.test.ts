import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiurClient } from '@ogm/aiur-client';
import { schema } from '@ogm/db';

import { createReviewSync } from '../../src/review-rounds/runner.js';
import { createQaAiurClient, withQaAiur } from '../../src/qa/aiur.js';
import { readQaState } from '../../src/qa/state.js';
import { authContextFor } from '../../src/auth/routes.js';
import { INTERNAL_TOKEN, makeApp, makeDeps } from '../helpers.js';

const QA_EMAIL = 'qa@example.test';
const b64 = (text: string) => Buffer.from(text).toString('base64');
type QaSession = { userId: string; gameId: string; cookie: { name: string; value: string } };
const MEDIA = { still: b64('qa-still'), clip: b64('qa-clip'), audio: b64('qa-audio') };

// The QA game reaches its recording boundary; any other game would reach a real daemon, which a test has none of.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function qaApp(maintainer?: string) {
  if (maintainer) vi.stubEnv('OGM_MAINTAINER_EMAILS', maintainer);
  const deps = makeDeps();
  const qa = createQaAiurClient(deps.db, () => deps.blobStore);
  const real = async (): Promise<AiurClient> => {
    throw new Error('real aiur reached');
  };
  deps.aiurClientForGame = withQaAiur(deps.db, qa, real);
  const { app } = await makeApp(deps);
  const internal = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-ogm-internal': INTERNAL_TOKEN, ...init.headers },
    });
  const sync = createReviewSync({
    db: deps.db,
    clientForGame: withQaAiur(deps.db, qa, real),
    issues: {} as never,
    log: deps.log,
  });
  return { app, deps, internal, sync };
}

async function session(internal: Awaited<ReturnType<typeof qaApp>>['internal'], email = QA_EMAIL) {
  const response = await internal('/internal/qa/session', { method: 'POST', body: JSON.stringify({ email }) });
  return { response, body: (await response.json()) as QaSession };
}

describe('QA creator account (#859)', () => {
  it('refuses on-demand worker starts at the QA boundary', async () => {
    const deps = makeDeps();
    const qa = createQaAiurClient(deps.db, () => deps.blobStore);
    await expect(
      qa.startAgentConversation({ text: 'test', owner: 'qa', client_request_id: 'qa-start' }),
    ).rejects.toMatchObject({ status: 501, code: 'qa_unsupported' });
  });

  it('is reachable only with the internal token', async () => {
    const { app } = await qaApp();
    const response = await app.request('/internal/qa/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: QA_EMAIL }),
    });
    expect(response.status).toBe(401);
  });

  // The fixture routes write and delete rows in the prod database; a user session or no credential never reaches them.
  it.each([
    ['POST', '/internal/qa/review-fixtures'],
    ['GET', '/internal/qa/review-fixtures/run-1'],
    ['DELETE', '/internal/qa/review-fixtures/run-1'],
    ['DELETE', '/internal/qa/review-fixtures'],
  ])('refuses %s %s without the internal token', async (method, path) => {
    const { app, internal } = await qaApp();
    const { body } = await session(internal);
    const response = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', cookie: `${body.cookie.name}=${body.cookie.value}` },
      ...(method === 'POST' ? { body: JSON.stringify({ run: 'run-1', media: MEDIA }) } : {}),
    });
    expect(response.status).toBe(401);
  });

  it('signs in a dedicated maker who owns one private game in a family of its own', async () => {
    const { app, deps, internal } = await qaApp();
    const { response, body } = await session(internal);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const me = await app.request('/api/v1/me', { headers: { cookie: `${body.cookie.name}=${body.cookie.value}` } });
    expect(me.status).toBe(200);
    const who = (await me.json()) as { user: { email: string }; family: { id: string; name: string } };
    expect(who.user.email).toBe(QA_EMAIL);

    const game = deps.db.select().from(schema.games).all();
    expect(game).toEqual([
      expect.objectContaining({
        id: body.gameId,
        ownerId: body.userId,
        familyId: who.family.id,
        visibility: 'private',
      }),
    ]);
    const members = deps.db.select().from(schema.familyMembers).all();
    expect(members).toEqual([expect.objectContaining({ familyId: who.family.id, userId: body.userId })]);

    // Running it again keeps the account and its game and mints a fresh session.
    const again = await session(internal);
    expect(again.body).toMatchObject({ userId: body.userId, gameId: body.gameId });
    expect(again.body.cookie.value).not.toBe(body.cookie.value);
  });

  it("never takes over an address that already signs in, or a maintainer's", async () => {
    const { deps, internal } = await qaApp();
    deps.db
      .insert(schema.allowedUsers)
      .values({ email: 'kevin@example.test', role: 'admin', addedBy: 'env', addedAt: '2026-11-01T00:00:00.000Z' })
      .run();
    expect((await session(internal, 'kevin@example.test')).response.status).toBe(409);
    expect(readQaState(deps.db)).toBeNull();

    // A maintainer's address is refused even after an admin took it off the allow list.
    const maintained = await qaApp('qa-owner@example.test');
    maintained.deps.db.delete(schema.allowedUsers).run();
    expect((await session(maintained.internal, 'qa-owner@example.test')).response.status).toBe(409);

    // One QA account per host: a second address is refused once the first exists.
    expect((await session(internal)).response.status).toBe(200);
    expect((await session(internal, 'other-qa@example.test')).response.status).toBe(409);
  });
});

// The QA address's allow-list and user rows; the test env seeds other addresses of its own.
function qaRows(deps: ReturnType<typeof makeDeps>) {
  const count = (rows: { email: string }[]) => rows.filter((row) => row.email === QA_EMAIL).length;
  return {
    allowed: count(deps.db.select().from(schema.allowedUsers).all()),
    users: count(deps.db.select().from(schema.user).all()),
  };
}

describe('QA account setup that fails midway', () => {
  it('leaves nothing behind, so the next run creates the account', async () => {
    const { deps, internal } = await qaApp();
    const ctx = await authContextFor(deps)!.auth.$context;
    vi.spyOn(ctx.internalAdapter, 'createUser').mockRejectedValueOnce(new Error('user store down'));
    expect((await session(internal)).response.status).toBe(500);
    expect(qaRows(deps)).toEqual({ allowed: 0, users: 0 });
    expect(readQaState(deps.db)).toBeNull();
    expect((await session(internal)).response.status).toBe(200);
  });

  it('removes a user and family it already made', async () => {
    const { deps, internal } = await qaApp();
    deps.sqlite.exec(
      "CREATE TRIGGER qa_game_fails BEFORE INSERT ON games BEGIN SELECT RAISE(ABORT, 'game store down'); END",
    );
    expect((await session(internal)).response.status).toBe(500);
    expect(qaRows(deps)).toEqual({ allowed: 0, users: 0 });
    expect(deps.db.select().from(schema.families).all()).toEqual([]);
    deps.sqlite.exec('DROP TRIGGER qa_game_fails');
    expect((await session(internal)).response.status).toBe(200);
  });
});

describe('QA review fixtures (#859)', () => {
  it("carry the creator's round and Command verdicts through the real routes to the QA aiur boundary", async () => {
    const { app, internal, sync } = await qaApp();
    const { body } = await session(internal);
    const cookie = { cookie: `${body.cookie.name}=${body.cookie.value}` };
    const json = { ...cookie, 'content-type': 'application/json' };

    const seeded = await internal('/internal/qa/review-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'run-1', media: MEDIA }),
    });
    expect(seeded.status).toBe(201);
    const { gameId, roundId, decisionId, options } = (await seeded.json()) as {
      gameId: string;
      roundId: string;
      decisionId: string;
      options: number;
    };
    expect(gameId).toBe(body.gameId);

    // The deck's two sources show the round with its three media and the Command with A-C.
    const rounds = (await (await app.request(`/api/v1/games/${gameId}/review-rounds`, { headers: cookie })).json()) as {
      rounds: { id: string; media: { kind: string }[] }[];
    };
    expect(rounds.rounds.map((round) => [round.id, round.media.map((item) => item.kind)])).toEqual([
      [roundId, ['still', 'clip', 'audio']],
    ]);
    const commands = (await (await app.request('/api/v1/me/commands', { headers: cookie })).json()) as {
      commands: { decision_id: string; version: number; options: { id: string; media?: unknown; audio?: unknown }[] }[];
    };
    const command = commands.commands.find((item) => item.decision_id === decisionId)!;
    expect(command.options.map((option) => option.id)).toEqual(['a', 'b', 'c']);
    // The E2E counts the options on screen against this, so a deck that drops one fails it (#863).
    expect(options).toBe(command.options.length);
    expect(command.options.every((option) => option.media ?? option.audio)).toBe(true);

    // The creator asks for changes on the round and picks B on the Command.
    const answered = await app.request(`/api/v1/games/${gameId}/review-rounds/${roundId}/answer`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ verdict: 'needs_work', note: 'QA note' }),
    });
    expect(answered.status).toBe(200);
    const picked = await app.request(`/api/v1/games/${gameId}/commands/${decisionId}/answer`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ option_id: 'b', version: command.version }),
    });
    expect(picked.status).toBe(200);

    // The review runner delivers the round's verdict; the status the deck polls reads "sent".
    await sync();
    const status = await app.request(`/api/v1/games/${gameId}/review-rounds/${roundId}/status`, { headers: cookie });
    expect(await status.json()).toMatchObject({ status: 'sent' });

    const report = (await (await internal('/internal/qa/review-fixtures/run-1')).json()) as {
      round: Record<string, unknown>;
      received: Record<string, unknown>[];
    };
    expect(report.round).toMatchObject({ verdict: 'needs_work', notes: 'QA note', dispatch: 'delivered' });
    expect(report.received).toEqual([
      expect.objectContaining({ kind: 'answer', decisionId, option: 'b' }),
      expect.objectContaining({
        kind: 'rework',
        key: `review-round:${roundId}`,
        reason: expect.stringContaining('QA note'),
      }),
    ]);

    // The Command left the inbox once answered, and cleanup removes the run.
    const after = (await (await app.request('/api/v1/me/commands', { headers: cookie })).json()) as {
      commands: unknown[];
    };
    expect(after.commands).toEqual([]);
    expect((await internal('/internal/qa/review-fixtures/run-1', { method: 'DELETE' })).status).toBe(200);
    expect((await internal('/internal/qa/review-fixtures/run-1')).status).toBe(404);
  });

  it('clears every run, so a run that died midway leaves nothing ahead of the next', async () => {
    const { app, internal } = await qaApp();
    const { body } = await session(internal);
    const cookie = { cookie: `${body.cookie.name}=${body.cookie.value}` };
    for (const run of ['run-1', 'run-2'])
      await internal('/internal/qa/review-fixtures', { method: 'POST', body: JSON.stringify({ run, media: MEDIA }) });
    expect((await internal('/internal/qa/review-fixtures', { method: 'DELETE' })).status).toBe(200);
    const rounds = (await (
      await app.request(`/api/v1/games/${body.gameId}/review-rounds`, { headers: cookie })
    ).json()) as { rounds: unknown[] };
    const commands = (await (await app.request('/api/v1/me/commands', { headers: cookie })).json()) as {
      commands: unknown[];
    };
    expect([rounds.rounds, commands.commands]).toEqual([[], []]);
  });

  it("keeps the deck's worker and ticket reads empty, not failed, for the repository-less QA game", async () => {
    const { app, internal } = await qaApp();
    const { body } = await session(internal);
    const cookie = { cookie: `${body.cookie.name}=${body.cookie.value}` };
    const workers = await app.request(`/api/v1/games/${body.gameId}/workers`, { headers: cookie });
    expect(workers.status).toBe(200);
    expect(await workers.json()).toMatchObject({ workers: [], daemonUnavailable: false });
    const completed = await app.request(`/api/v1/games/${body.gameId}/tickets/completed`, { headers: cookie });
    expect(await completed.json()).toEqual({ tickets: [], stale: false });
  });

  it('refuses fixtures before the QA account exists', async () => {
    const { internal } = await qaApp();
    const seeded = await internal('/internal/qa/review-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'run-1', media: MEDIA }),
    });
    expect(seeded.status).toBe(409);
  });

  it('leaves every other game on its real aiur instance', async () => {
    const deps = makeDeps();
    const real = { baseUrl: 'real' } as AiurClient;
    const lookup = withQaAiur(
      deps.db,
      createQaAiurClient(deps.db, () => deps.blobStore),
      async () => real,
    );
    expect(await lookup('g_other')).toBe(real);
  });
});

describe('QA Energy budget probe', () => {
  it('exercises real admission routes, fences side effects and restores the QA budget', async () => {
    const { app, deps, internal } = await qaApp();
    const { body: qa } = await session(internal);
    const assistantCreate = vi.fn().mockResolvedValue({ repo: 'qa/test', ticket: '1' });
    deps.registry.draftScopeAssistant = { create: assistantCreate, close: vi.fn(), transcript: vi.fn() };
    deps.db.insert(schema.weeklyJobBudgets).values({ email: QA_EMAIL, newGames: 3, edits: 4 }).run();
    expect((await app.request('/internal/qa/energy-budget/begin', { method: 'POST' })).status).toBe(401);
    const begun = await internal('/internal/qa/energy-budget/begin', { method: 'POST' });
    expect(begun.status).toBe(200);
    const { id } = (await begun.json()) as { id: string };
    expect((await internal('/internal/qa/energy-budget/begin', { method: 'POST' })).status).toBe(409);
    const headers = {
      cookie: `${qa.cookie.name}=${qa.cookie.value}`,
      'content-type': 'application/json',
      'x-ogm-internal': INTERNAL_TOKEN,
      'x-ogm-qa-energy-probe': id,
    };
    const choices = {
      genre: 'platformer',
      vibe: 'cozy',
      family: 'chunky-low-poly',
      world: 'floating islands',
      players: 'single',
      pov: 'isometric',
    };
    const draft = () =>
      app.request('/api/v1/game-drafts', { method: 'POST', headers, body: JSON.stringify({ choices }) });
    const result = await draft();
    expect(result.status).toBe(402);
    expect(await result.json()).toMatchObject({ reason: 'weekly_user', window: 'week', resetsAt: expect.any(String) });
    const plan = {
      title: 'Probe',
      summary: 'Probe',
      scope: { included: [], excluded: [] },
      tickets: [{ key: 'qa', skills: [], dependsOn: [], acceptanceCriteria: ['refused'] }],
    };
    for (const kind of ['new_game', 'feature', 'repair']) {
      const response = await app.request('/api/v1/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({ gameId: qa.gameId, branchId: 'main', kind, complexity: 1, start: 'now', plan }),
      });
      expect(response.status).toBe(402);
      expect(await response.json()).toMatchObject({ reason: 'weekly_user', window: 'week' });
    }
    const report = {
      gameId: qa.gameId,
      buildHash: '0'.repeat(64),
      text: `qa-energy-probe:${id}`,
      error: {
        type: 'QaEnergyProbe',
        message: 'Energy probe',
        frames: [{ file: `/g/${qa.gameId}/qa/probe-${id}.js`, line: 1, fn: id }],
      },
    };
    const reportResponse = await app.request('/api/v1/reports', {
      method: 'POST',
      headers,
      body: JSON.stringify(report),
    });
    expect(reportResponse.status).toBe(201);
    expect(await reportResponse.json()).toMatchObject({
      pendingBudget: true,
      budgetReason: 'weekly_user',
      resetsAt: expect.any(String),
    });
    expect(deps.db.select().from(schema.reports).all()).toEqual([]);
    expect(deps.db.select().from(schema.reportSignatures).all()).toEqual([]);
    // Simulate a missing personal guard: the independent fence still prevents dispatch.
    deps.db.update(schema.weeklyJobBudgets).set({ newGames: null, edits: null }).run();
    expect((await draft()).status).toBe(409);
    const fencedReport = await app.request('/api/v1/reports', {
      method: 'POST',
      headers,
      body: JSON.stringify(report),
    });
    expect(fencedReport.status).toBe(502);
    expect(deps.db.select().from(schema.reports).all()).toEqual([]);
    expect(assistantCreate).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.jobs).all()).toEqual([]);
    expect(
      (await internal('/internal/qa/energy-budget/end', { method: 'POST', body: JSON.stringify({ id }) })).status,
    ).toBe(204);
    expect(deps.db.select().from(schema.weeklyJobBudgets).all()).toMatchObject([
      { email: QA_EMAIL, newGames: 3, edits: 4 },
    ]);
    // Requests delayed until after restoration still cannot dispatch work or leave a report.
    const staleReport = await app.request('/api/v1/reports', { method: 'POST', headers, body: JSON.stringify(report) });
    expect(staleReport.status).toBe(409);
    expect(deps.db.select().from(schema.reports).all()).toEqual([]);
    expect((await draft()).status).toBe(409);
    const delayedJob = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ gameId: qa.gameId, branchId: 'main', kind: 'feature', complexity: 1, start: 'now', plan }),
    });
    expect(delayedJob.status).toBe(409);
    expect(assistantCreate).not.toHaveBeenCalled();
  }, 120_000);
});
