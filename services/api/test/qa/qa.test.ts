import { describe, expect, it } from 'vitest';
import type { AiurClient } from '@ogm/aiur-client';
import { schema } from '@ogm/db';

import { createReviewSync } from '../../src/review-rounds/runner.js';
import { createQaAiurClient, withQaAiur } from '../../src/qa/aiur.js';
import { readQaState } from '../../src/qa/state.js';
import { INTERNAL_TOKEN, makeApp, makeDeps } from '../helpers.js';

const QA_EMAIL = 'qa@example.test';
const b64 = (text: string) => Buffer.from(text).toString('base64');
const MEDIA = { still: b64('qa-still'), clip: b64('qa-clip'), audio: b64('qa-audio') };

// The QA game reaches its recording boundary; any other game would reach a real daemon, which a test has none of.
async function qaApp() {
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
  return { response, body: (await response.json()) as Record<string, any> };
}

describe('QA creator account (#859)', () => {
  it('is reachable only with the internal token', async () => {
    const { app } = await qaApp();
    const response = await app.request('/internal/qa/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: QA_EMAIL }),
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

    // One QA account per host: a second address is refused once the first exists.
    expect((await session(internal)).response.status).toBe(200);
    expect((await session(internal, 'other-qa@example.test')).response.status).toBe(409);
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
    const { gameId, roundId, decisionId } = (await seeded.json()) as Record<string, string>;
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
