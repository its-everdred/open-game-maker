import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { loadApiEnv } from '../src/app/env.js';
import { createGameRow } from '../src/games/games.js';
import { activeTargetFor } from '../src/voice/briefing-push.js';
import { mintVoiceToken, VOICE_TOKEN_TTL_SEC } from '../src/voice/token.js';
import { makeApiEnv } from './env-fixture.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const now = '2026-11-01T00:00:00.000Z';
const familyId = 'f-family';
const secret = 'ogm-test-secret-0123456789abcdef0123';
const wsUrl = 'wss://voice.example.test/ws/voice';
const member = (userId: string, capability: 'creator' | 'player' = 'creator'): TestUser => ({
  kind: 'user',
  userId,
  email: `${userId}@example.com`,
  familyId,
  platformRole: 'none',
  capability,
});
const creator = member('u-creator');
const sibling = member('u-sibling');

function decode(token: string) {
  const [prefix, payload, mac] = token.split('.');
  return {
    prefix,
    mac,
    body: `${prefix}.${payload}`,
    claims: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>,
  };
}

async function setup(
  config: { voiceTokenSecret?: string; voiceWsUrl?: string } = { voiceTokenSecret: secret, voiceWsUrl: wsUrl },
) {
  const deps = makeDeps();
  Object.assign(deps.config, config);
  installUsers(deps, [creator, sibling]);
  deps.db
    .insert(schema.families)
    .values({ id: familyId, name: 'Household', ownerUserId: creator.userId, createdAt: now })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values(
      [creator, sibling].map(({ userId }) => ({
        familyId,
        userId,
        role: 'member',
        capability: 'creator',
        joinedAt: now,
      })),
    )
    .run();
  const game = createGameRow(deps.db, {
    familyId,
    ownerId: creator.userId,
    title: 'Castle',
    repoVisibility: 'private',
  });
  const other = createGameRow(deps.db, {
    familyId,
    ownerId: creator.userId,
    title: 'Moat',
    repoVisibility: 'private',
  });
  insertJob(deps, 'j-1', game.id);
  insertJob(deps, 'j-other', other.id);
  const scopeSessionId = 's_22000000-0000-4000-8000-000000000001';
  deps.db
    .insert(schema.scopeSessions)
    .values({
      id: scopeSessionId,
      gameId: game.id,
      creatorId: creator.userId,
      jobId: 'j-1',
      status: 'open',
      choices: JSON.stringify({
        genre: 'platformer',
        vibe: 'cozy',
        family: 'chunky-low-poly',
        world: 'cavern',
        players: 'single',
        pov: 'side-on',
      }),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const { app } = await makeApp(deps);
  const request = (user: TestUser, target: Record<string, string>, path = '/api/v1/voice/token') =>
    app.request(path, {
      method: 'POST',
      headers: { ...asUser(user.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ target }),
    });
  return { request, gameId: game.id, scopeSessionId };
}

function insertJob(deps: ReturnType<typeof makeDeps>, id: string, gameId: string) {
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId,
      branchId: 'main',
      familyId,
      creatorId: creator.userId,
      kind: 'feature',
      complexity: 1,
      state: 'running',
      start: 'now',
      slot: 'edit',
      plan: '{}',
      reservation: '{}',
      hardCapMicroUsd: 500_000,
      aiurRepo: 'owner/game',
      aiurIssueNumber: id === 'j-1' ? 142 : 143,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

const buildTarget = (gameId: string, creatorId = creator.userId, jobId = 'j-1') => ({
  kind: 'build',
  game_id: gameId,
  job_id: jobId,
  ticket: '142',
  creator_id: creatorId,
});

describe('POST /api/v1/voice/token', () => {
  it('mints a vct1 token for the game owner, signed with the shared secret and valid for at most 300 s', async () => {
    const { request, gameId } = await setup();
    const before = Math.floor(Date.now() / 1000);
    const response = await request(creator, buildTarget(gameId));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; expires_at: string; url: string };
    expect(body.url).toBe(wsUrl);
    const { prefix, body: signed, mac, claims } = decode(body.token);
    expect(prefix).toBe('vct1');
    expect(mac).toBe(createHmac('sha256', secret).update(signed).digest('base64url'));
    expect(claims).toMatchObject({ scope: 'converse', sub: creator.userId });
    expect(claims.target).toEqual(buildTarget(gameId));
    expect(activeTargetFor(creator.userId)).toEqual(buildTarget(gameId));
    expect(claims.exp as number).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + VOICE_TOKEN_TTL_SEC);
    expect(claims.exp as number).toBeGreaterThanOrEqual(before + VOICE_TOKEN_TTL_SEC);
    expect(Date.parse(body.expires_at)).toBe((claims.exp as number) * 1000);
  });

  it("refuses a family member who may not edit the game (403), so the voice host never sees another creator's target", async () => {
    const { request, gameId } = await setup();
    const response = await request(sibling, buildTarget(gameId, sibling.userId));
    expect(response.status).toBe(403);
  });

  it('refuses a target naming someone else as creator, since the host binds the session to the token subject', async () => {
    const { request, gameId } = await setup();
    const response = await request(creator, buildTarget(gameId, sibling.userId));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'not_target_creator' });
  });

  // A quick question session (#612) is the game's: only someone who may edit the game, as themselves, gets one.
  it('mints a question-session token for the game owner and refuses one for a member who may not edit', async () => {
    const { request, gameId } = await setup();
    const questions = { kind: 'questions', game_id: gameId, creator_id: creator.userId };

    const response = await request(creator, questions);
    expect(response.status).toBe(200);
    expect(decode(((await response.json()) as { token: string }).token).claims.target).toEqual(questions);
    expect((await request(sibling, { ...questions, creator_id: sibling.userId })).status).toBe(403);
  });

  it("refuses another game's job (403): the host reads briefings and sends instructions by job_id alone", async () => {
    const { request, gameId } = await setup();
    const response = await request(creator, buildTarget(gameId, creator.userId, 'j-other'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'job_not_in_game' });
  });

  it('answers 404 for a job that does not exist', async () => {
    const { request, gameId } = await setup();
    const response = await request(creator, buildTarget(gameId, creator.userId, 'j-missing'));
    expect(response.status).toBe(404);
  });

  it('answers 503 until the voice secret and URL are configured', async () => {
    const { request, gameId } = await setup({});
    const response = await request(creator, buildTarget(gameId));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'voice_unavailable' });
  });

  it('rejects a malformed target', async () => {
    const { request, gameId } = await setup();
    const response = await request(creator, { kind: 'scope', game_id: gameId, creator_id: creator.userId });
    expect(response.status).toBe(400);
  });

  it('refuses stale scope sessions and build targets with a forged ticket', async () => {
    const { request, gameId } = await setup();
    const stale = await request(creator, {
      kind: 'scope',
      game_id: gameId,
      session_id: 's-missing',
      creator_id: creator.userId,
    });
    const forged = await request(creator, { ...buildTarget(gameId), ticket: '999' });

    expect(stale.status).toBe(403);
    expect(forged.status).toBe(403);
  });
});

describe('POST /api/v1/voice/dictation-token', () => {
  it('mints a target-bound dictate token and selects dictation on the existing voice URL', async () => {
    const { request, gameId, scopeSessionId } = await setup();
    const target = {
      kind: 'scope',
      game_id: gameId,
      session_id: scopeSessionId,
      creator_id: creator.userId,
    };
    const response = await request(creator, target, '/api/v1/voice/dictation-token');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; url: string };
    expect(decode(body.token).claims).toMatchObject({ scope: 'dictate', sub: creator.userId, target });
    expect(new URL(body.url).searchParams.get('mode')).toBe('dictate');
  });

  it('throttles creator token acquisition before paid dictation can start', async () => {
    const { request, gameId } = await setup();

    for (let count = 0; count < 10; count += 1) {
      expect((await request(creator, buildTarget(gameId), '/api/v1/voice/dictation-token')).status).toBe(200);
    }
    const refused = await request(creator, buildTarget(gameId), '/api/v1/voice/dictation-token');

    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: 'rate_limited' });
  });
});

describe('voice token configuration', () => {
  const baseEnv = makeApiEnv();

  it('refuses a token secret the voice host would reject (under 32 bytes), naming the variable', () => {
    expect(() => loadApiEnv({ ...baseEnv, OGM_VOICE_TOKEN_SECRET: 'x'.repeat(31) })).toThrow(/OGM_VOICE_TOKEN_SECRET/);
    expect(loadApiEnv({ ...baseEnv, OGM_VOICE_TOKEN_SECRET: secret }).OGM_VOICE_TOKEN_SECRET).toBe(secret);
    expect(loadApiEnv(baseEnv).OGM_VOICE_TOKEN_SECRET).toBeUndefined();
  });

  it('requires a WebSocket URL when voice is configured', () => {
    expect(() => loadApiEnv({ ...baseEnv, OGM_VOICE_WS_URL: 'https://voice.example.test/ws/voice' })).toThrow(
      /OGM_VOICE_WS_URL/,
    );
    expect(loadApiEnv({ ...baseEnv, OGM_VOICE_WS_URL: wsUrl }).OGM_VOICE_WS_URL).toBe(wsUrl);
  });
});

// Cross-language vectors: the voice host's ExUnit `token_test` verifies each with the same secret
// and clock, so a format drift on either side fails there. Minting is deterministic (fixed clock
// and nonce), so rewriting the fixture on every run leaves it unchanged.
describe('voice token vectors', () => {
  it('writes the vectors the Elixir verifier checks', () => {
    const nowMs = Date.UTC(2026, 10, 1, 5, 25);
    const verifyAt = nowMs / 1000;
    const target = buildTarget('g-vector');
    const mint = (opts: { nowMs: number; scope?: string }) =>
      mintVoiceToken({ secret, sub: 'u-creator', target, nonce: 'AAAAAAAAAAAAAAAA', ...opts }).token;
    const valid = mint({ nowMs });
    const flipped = valid.at(-2) === 'A' ? 'B' : 'A';
    const vectors = {
      secret,
      verify_at: verifyAt,
      vectors: [
        { name: 'valid', token: valid, sub: 'u-creator', target, exp: verifyAt + VOICE_TOKEN_TTL_SEC, expect: 'ok' },
        { name: 'expired', token: mint({ nowMs: nowMs - 600_000 }), expect: 'expired' },
        { name: 'tampered', token: `${valid.slice(0, -2)}${flipped}${valid.at(-1)}`, expect: 'invalid' },
        { name: 'other scope', token: mint({ nowMs, scope: 'narrate' }), expect: 'wrong_scope' },
      ],
    };
    expect(decode(valid).claims).toEqual({
      scope: 'converse',
      sub: 'u-creator',
      exp: verifyAt + 300,
      nonce: 'AAAAAAAAAAAAAAAA',
      target,
    });
    writeFileSync(
      new URL('../../voice-host/test/fixtures/token_vectors.json', import.meta.url),
      `${JSON.stringify(vectors, null, 2)}\n`,
    );
  });
});
