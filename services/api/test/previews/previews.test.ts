import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

import { schema } from '@ogm/db';
import { createApp as createGamesHost } from '../../../games-host/src/server.js';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import previewRoutes from '../../src/previews/routes.js';
import roundRoutes from '../../src/review-rounds/routes.js';
import { answerPreview, previewDirectory } from '../../src/previews/store.js';
import { getRound, postRound } from '../../src/review-rounds/store.js';
import { createReviewSync } from '../../src/review-rounds/runner.js';
import type { AiurClient } from '@ogm/aiur-client';
import { scanPreviewRelay } from '../../src/previews/relay.js';
import { previewTicketVerifier } from '../../src/previews/ticket.js';
import { daemonRowForGame } from '../../src/jobs/daemons.js';
import { createApp } from '../../src/app/app.js';
import { buildRoutes } from '../../src/builds/routes.js';
import { mintPreviewToken } from '../../src/builds/preview-token.js';
import { hookPreviewToken } from '../../src/internal/bundle.js';
import { asUser } from '../helpers.js';
import { builtFiles, ids, REPO, SECRET, SHA, world } from '../builds/fixtures.js';

const archive = () => execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', builtFiles(), '.']);

function setup() {
  const { deps } = world();
  const app = createApp(deps);
  app.route(
    '/internal',
    buildRoutes({
      daemonForSecret: async (secret) => (secret === SECRET ? REPO : null),
      gameForSecret: async (secret) => (secret === SECRET ? { repo: REPO, slug: 'castle-game' } : null),
      trackFor: async (_checkout, _path, _sha, id) => ({
        id,
        category: id === 'sound' ? 'sound' : id === 'game' || id === 'mock-game' ? 'gameplay' : 'art',
        phases: [
          { id: id === 'mock-game' ? 'mock' : id === 'sound' ? 'cue' : 'concept', ticket: '12', template: 'next' },
        ],
      }),
    }),
  );
  const [owner, repo] = REPO.split('/');
  deps.db.update(schema.games).set({ githubOwner: owner, githubRepo: repo }).where(eq(schema.games.id, ids.game)).run();
  const message = vi.fn(async () => ({}));
  deps.aiurClientForGame = vi.fn(async () => ({ message }) as never);
  app.route('/api/v1', previewRoutes);
  app.route('/api/v1', roundRoutes);
  const upload = (ticket = '12', auth = SECRET, body = archive(), branch = 'main') =>
    app.request(`http://example.test/internal/games/castle-game/previews/${ticket}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth}`, 'x-gm-sha': SHA, 'x-gm-branch': branch },
      body,
    });
  const list = () =>
    app.request(`http://example.test/api/v1/games/${ids.game}/previews`, { headers: asUser(ids.user) });
  const editorList = () =>
    app.request(`http://example.test/api/v1/games/${ids.game}/editor/previews`, { headers: asUser(ids.user) });
  const answer = (buildId: string, note = 'Great') =>
    app.request(`http://example.test/api/v1/games/${ids.game}/previews/12/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ buildId, verdict: 'looks right', note }),
    });
  return { deps, app, upload, list, editorList, answer, message };
}

function enableTracks(deps: ReturnType<typeof setup>['deps']) {
  deps.db
    .insert(schema.gameDaemons)
    .values({
      slug: 'castle-game',
      repo: REPO,
      checkoutPath: '/fixture',
      unit: 'fixture',
      envFile: '/fixture',
      port: 12345,
      status: 'running',
      createdAt: '2026-11-13T00:00:00Z',
    })
    .run();
}

describe('review round previews', () => {
  it('records creator notes and reports delivery after the reconciler sends them to the worker', async () => {
    const { deps, app } = setup();
    postRound(deps.db, {
      id: 'reconcile-round',
      gameId: ids.game,
      track: 'art',
      phase: 'concept',
      category: 'art',
      round: 1,
      ticket: '12',
      sha: SHA,
      media: '[]',
      postedAt: '2026-11-14T00:00:00Z',
    });
    const base = `http://example.test/api/v1/games/${ids.game}/review-rounds/reconcile-round`;
    const status = async () =>
      (await (await app.request(`${base}/status`, { headers: asUser(ids.user) })).json()) as { status: string };
    expect((await status()).status).toBe('open');
    expect(
      (
        await app.request(`${base}/answer`, {
          method: 'POST',
          headers: { ...asUser(ids.user), 'content-type': 'application/json' },
          body: JSON.stringify({ verdict: 'needs_work', note: 'More contrast' }),
        })
      ).status,
    ).toBe(200);
    expect(getRound(deps.db, ids.game, 'reconcile-round')?.notes).toBe('More contrast');
    expect((await status()).status).toBe('pending');
    let message: string | null = null;
    const rework = vi.fn(async (_ticket: string, reason: string) => {
      message = reason;
    });
    const client = {
      rework,
      ticketTranscript: async () => ({ events: message ? [{ body: message, turn_id: null }] : [], nextCursor: null }),
      issue: async () =>
        message
          ? {
              status: 'running',
              running: { session_id: 'run-1', started_at: '2026-11-14T01:00:01Z' },
              queue: { depth: 0 },
            }
          : { status: 'idle', running: null, queue: { depth: 0 } },
    } as unknown as AiurClient;
    const sync = createReviewSync({
      db: deps.db,
      clientForGame: async () => client,
      log: () => {},
      issues: { legacyStarted: vi.fn(), integrated: vi.fn(), setFidelity: vi.fn(), close: vi.fn(), cancel: vi.fn() },
      now: () => Date.parse('2026-11-14T01:01:00Z'),
    });
    await sync();
    expect(rework).toHaveBeenCalledOnce();
    expect(message).toContain('More contrast');
    expect((await status()).status).toBe('sent');
    deps.db
      .insert(schema.reviewPhaseOwners)
      .values({
        gameId: ids.game,
        track: 'art',
        phase: 'build',
        ticket: '12',
        sourceRoundId: 'reconcile-round',
      })
      .run();
    postRound(deps.db, {
      id: 'next-round',
      gameId: ids.game,
      track: 'art',
      phase: 'build',
      category: 'art',
      round: 1,
      ticket: '12',
      sha: SHA,
      media: '[]',
      postedAt: '2026-11-15T00:00:00Z',
    });
    expect(await status()).toMatchObject({
      status: 'sent',
      nextPhase: { phase: 'build', ticket: '12' },
      newRound: true,
    });
  });
  it('hides and rejects a preview whose review round has been superseded', async () => {
    const { deps, upload, list, answer, message } = setup();
    const preview = (await (await upload()).json()) as { buildId: string };
    const row = { gameId: ids.game, round: 1, ticket: '12', sha: SHA, postedAt: '2026-11-14T00:00:00Z' };
    postRound(deps.db, {
      ...row,
      id: 'old-preview',
      track: 'game',
      phase: 'build',
      category: 'gameplay',
      media: JSON.stringify([{ kind: 'build', ref: preview.buildId }]),
    });
    postRound(deps.db, {
      ...row,
      id: 'new-art',
      track: 'art',
      phase: 'build',
      category: 'art',
      media: '[]',
      postedAt: '2026-11-15T00:00:00Z',
    });
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toEqual([]);
    expect((await answer(preview.buildId)).status).toBe(409);
    expect(await answerPreview(deps, ids.game, '12', preview.buildId, 'old review', 'looks right', undefined)).toBe(
      false,
    );
    expect(getRound(deps.db, ids.game, 'old-preview')?.verdict).toBeNull();
    expect(message).not.toHaveBeenCalled();
    expect((await upload()).status).toBe(201);
  });
  it('hides and rejects a standalone preview when a newer round exists', async () => {
    const { deps, upload, list, answer, message } = setup();
    await upload();
    const preview = ((await (await list()).json()) as { previews: { buildId: string; createdAt: string }[] })
      .previews[0]!;
    postRound(deps.db, {
      gameId: ids.game,
      round: 1,
      ticket: '12',
      sha: SHA,
      postedAt: new Date(Date.parse(preview.createdAt) + 1000).toISOString(),
      id: 'new-art',
      track: 'art',
      phase: 'build',
      category: 'art',
      media: '[]',
    });
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toEqual([]);
    expect((await answer(preview.buildId)).status).toBe(409);
    expect(await answerPreview(deps, ids.game, '12', preview.buildId, 'old review', 'looks right', undefined)).toBe(
      false,
    );
    expect(message).not.toHaveBeenCalled();
  });
  it('lists only the latest round per ticket, even when the latest has already been answered', async () => {
    const { deps, app } = setup();
    const row = {
      gameId: ids.game,
      track: 'art',
      category: 'art' as const,
      round: 1,
      sha: SHA,
      media: '[]',
      postedAt: '2026-11-14T00:00:00Z',
    };
    postRound(deps.db, { ...row, id: 'old', phase: 'mock', ticket: '12' });
    postRound(deps.db, { ...row, id: 'new', phase: 'build', ticket: '12' });
    postRound(deps.db, { ...row, id: 'other', phase: 'mock', ticket: '13', track: 'other' });
    postRound(deps.db, {
      ...row,
      id: 'old-format',
      phase: 'mock',
      ticket: '14',
      track: 'third',
      postedAt: '2026-11-14T00:00:00Z',
    });
    postRound(deps.db, {
      ...row,
      id: 'new-format',
      phase: 'build',
      ticket: '14',
      track: 'third',
      postedAt: '2026-11-14T00:00:00.001Z',
    });
    const list = async () =>
      (
        await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds`, {
          headers: asUser(ids.user),
        })
      ).json();
    expect(await list()).toMatchObject({ rounds: [{ id: 'new' }, { id: 'other' }, { id: 'new-format' }] });
    const oldAnswer = await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds/old/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ verdict: 'approved' }),
    });
    expect(oldAnswer.status).toBe(409);
    expect(getRound(deps.db, ids.game, 'old')?.verdict).toBeNull();
    expect(
      (
        await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds/old/missing-media`, {
          method: 'POST',
          headers: asUser(ids.user),
        })
      ).status,
    ).toBe(409);
    deps.db
      .update(schema.reviewRounds)
      .set({ verdict: 'approved', verdictAt: row.postedAt, verdictSource: 'command' })
      .where(eq(schema.reviewRounds.id, 'new'))
      .run();
    expect(await list()).toMatchObject({ rounds: [{ id: 'other' }, { id: 'new-format' }] });
  });
  it('does not expose unverified audio attached to a legacy sound round', async () => {
    const { deps, app } = setup();
    postRound(deps.db, {
      id: 'legacy-audio',
      gameId: ids.game,
      track: 'sound',
      phase: 'mock',
      category: 'sound',
      round: 1,
      ticket: '12',
      sha: SHA,
      media: JSON.stringify([{ kind: 'audio', ref: `sha256:${'a'.repeat(64)}` }]),
      postedAt: '2026-01-01',
    });
    const response = await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds`, {
      headers: asUser(ids.user),
    });
    expect(await response.json()).toMatchObject({ rounds: [{ id: 'legacy-audio', media: [] }] });
  });
  it('includes open gameplay rounds only when requested, with their playable build reference', async () => {
    const { deps, app } = setup();
    postRound(deps.db, {
      id: 'round-game',
      gameId: ids.game,
      track: 'game',
      phase: 'play',
      category: 'gameplay',
      round: 1,
      ticket: '12',
      sha: SHA,
      media: JSON.stringify([{ kind: 'build', ref: 'preview-build' }]),
      postedAt: '2026-11-14T00:00:00Z',
    });
    const normal = await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds`, {
      headers: asUser(ids.user),
    });
    expect(await normal.json()).toEqual({ rounds: [] });
    const included = await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds?includeGameplay=1`, {
      headers: asUser(ids.user),
    });
    expect(await included.json()).toMatchObject({
      rounds: [{ id: 'round-game', category: 'gameplay', buildId: 'preview-build' }],
    });
  });

  it('asks the worker for missing round media and refuses when media exists', async () => {
    const { deps, app, message } = setup();
    postRound(deps.db, {
      id: 'missing-round',
      gameId: ids.game,
      track: 'art',
      phase: 'concept',
      category: 'art',
      round: 1,
      ticket: '12',
      sha: SHA,
      media: '[]',
      postedAt: '2026-11-14T00:00:00Z',
    });
    const path = `/api/v1/games/${ids.game}/review-rounds/missing-round/missing-media`;
    expect((await app.request(path, { method: 'POST', headers: asUser(ids.user) })).status).toBe(200);
    expect(message).toHaveBeenCalledWith(
      '12',
      expect.stringContaining('missing media'),
      'review-media:missing-round',
      expect.any(AbortSignal),
    );
    deps.db
      .update(schema.reviewRounds)
      .set({ media: JSON.stringify([{ kind: 'still', ref: `sha256:${'a'.repeat(64)}` }]) })
      .where(eq(schema.reviewRounds.id, 'missing-round'))
      .run();
    const available = await app.request(path, { method: 'POST', headers: asUser(ids.user) });
    expect(available.status).toBe(409);
    expect(await available.json()).toMatchObject({ error: 'media_present' });
    expect(message).toHaveBeenCalledOnce();
  });

  it('asks for a missing playable but rejects a stale request when the preview exists', async () => {
    const { deps, app, upload, message } = setup();
    postRound(deps.db, {
      id: 'missing-playable',
      gameId: ids.game,
      track: 'game',
      phase: 'play',
      category: 'gameplay',
      round: 1,
      ticket: '12',
      sha: SHA,
      media: JSON.stringify([
        { kind: 'build', ref: 'preview-missing' },
        { kind: 'still', ref: `sha256:${'a'.repeat(64)}` },
      ]),
      postedAt: '2026-11-14T00:00:00Z',
    });
    const path = `/api/v1/games/${ids.game}/review-rounds/missing-playable/missing-media?kind=build`;
    expect((await app.request(path, { method: 'POST', headers: asUser(ids.user) })).status).toBe(200);
    expect(message).toHaveBeenCalledOnce();
    const preview = (await (await upload()).json()) as { buildId: string };
    deps.db
      .update(schema.reviewRounds)
      .set({ media: JSON.stringify([{ kind: 'build', ref: preview.buildId }]) })
      .where(eq(schema.reviewRounds.id, 'missing-playable'))
      .run();
    const available = await app.request(path, { method: 'POST', headers: asUser(ids.user) });
    expect(available.status).toBe(409);
    expect(await available.json()).toMatchObject({ error: 'media_present' });
    expect(message).toHaveBeenCalledOnce();
  });

  it('does not request media for a round superseded while finding its client', async () => {
    const { deps, app, message } = setup();
    const round = {
      gameId: ids.game,
      track: 'game',
      phase: 'play',
      category: 'gameplay',
      ticket: '12',
      sha: SHA,
      media: JSON.stringify([{ kind: 'build', ref: 'missing' }]),
    };
    postRound(deps.db, { ...round, id: 'old-round', round: 1, postedAt: '2026-11-14T00:00:00Z' });
    let release!: () => void;
    let started!: () => void;
    const clientStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waitForClient = new Promise<void>((resolve) => {
      release = resolve;
    });
    deps.aiurClientForGame = vi.fn(async () => {
      started();
      await waitForClient;
      return { message } as never;
    });
    const response = app.request(`/api/v1/games/${ids.game}/review-rounds/old-round/missing-media?kind=build`, {
      method: 'POST',
      headers: asUser(ids.user),
    });
    await clientStarted;
    postRound(deps.db, { ...round, id: 'new-round', round: 2, postedAt: '2026-11-14T00:01:00Z' });
    release();
    expect((await response).status).toBe(409);
    expect(message).not.toHaveBeenCalled();
  });

  it('shows an art round and records the owner verdict exactly once', async () => {
    const { deps, app } = setup();
    enableTracks(deps);
    const image = await deps.blobStore.put(
      readFileSync(new URL('../build-chat/fixtures/tiny.png', import.meta.url)),
      'image/png',
    );
    const id = 'd9428888-122b-4b0e-b1c8-9f7900000010';
    const posted = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        track: 'art',
        phase: 'concept',
        category: 'art',
        ticket: '12',
        sha: SHA,
        media: [
          { kind: 'still', ref: image.hash },
          { kind: 'still', ref: image.hash, role: 'target' },
        ],
      }),
    });
    expect(posted.status).toBe(201);
    expect(getRound(deps.db, ids.game, id)?.effort).toBe('low');
    const list = await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds`, {
      headers: asUser(ids.user),
    });
    expect(await list.json()).toMatchObject({
      rounds: [
        {
          id,
          media: [
            { kind: 'still', url: expect.any(String) },
            { kind: 'still', role: 'target', url: expect.any(String) },
          ],
        },
      ],
    });
    const answer = (verdict: string) =>
      app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds/${id}/answer`, {
        method: 'POST',
        headers: { ...asUser(ids.user), 'content-type': 'application/json' },
        body: JSON.stringify({ verdict, note: '  Keep\nthis.  ' }),
      });
    expect((await answer('needs_work')).status).toBe(200);
    expect((await answer('needs_work')).status).toBe(200);
    expect((await answer('approved')).status).toBe(409);
    expect(deps.db.select().from(schema.reviewRounds).get()).toMatchObject({
      verdict: 'needs_work',
      notes: '  Keep\nthis.  ',
    });
    expect(
      await (
        await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds`, { headers: asUser(ids.user) })
      ).json(),
    ).toEqual({ rounds: [] });
  });

  it('accepts and lists a gameplay mock without a preview build', async () => {
    const { deps, app } = setup();
    enableTracks(deps);
    const image = await deps.blobStore.put(
      readFileSync(new URL('../build-chat/fixtures/tiny.png', import.meta.url)),
      'image/png',
    );
    const id = 'd9428888-122b-4b0e-b1c8-9f7900000011';
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        track: 'mock-game',
        phase: 'mock',
        category: 'gameplay',
        ticket: '12',
        sha: SHA,
        question: 'Which?',
        media: [{ kind: 'still', ref: image.hash }],
      }),
    });
    expect(response.status).toBe(201);
    const list = await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds`, {
      headers: asUser(ids.user),
    });
    expect(await list.json()).toMatchObject({
      rounds: [
        {
          id,
          media: [{ kind: 'still', url: expect.stringContaining('https://app.example.test/api/v1/blobs/sha256/') }],
        },
      ],
    });
    const answer = await app.request(`http://example.test/api/v1/games/${ids.game}/review-rounds/${id}/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ verdict: 'needs_work', note: 'Make it faster' }),
    });
    expect(answer.status).toBe(200);
  });

  it('refuses a round from a ticket that does not own the phase', async () => {
    const { app, deps } = setup();
    enableTracks(deps);
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000004',
        track: 'art',
        phase: 'concept',
        category: 'art',
        ticket: '99',
        sha: SHA,
        media: [{ kind: 'still', ref: 'concept' }],
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'track_owner_mismatch' } });
  });

  it('rejects extra audio references attached to an art round', async () => {
    const { deps, app } = setup();
    enableTracks(deps);
    const image = await deps.blobStore.put(
      readFileSync(new URL('../build-chat/fixtures/tiny.png', import.meta.url)),
      'image/png',
    );
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000012',
        track: 'art',
        phase: 'concept',
        category: 'art',
        ticket: '12',
        sha: SHA,
        media: [
          { kind: 'still', ref: image.hash },
          { kind: 'audio', ref: image.hash },
        ],
      }),
    });
    expect(response.status).toBe(422);
  });
  it('does not let a gameplay track evade preview requirements by claiming another category', async () => {
    const { app, deps } = setup();
    enableTracks(deps);
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000005',
        track: 'game',
        phase: 'concept',
        category: 'art',
        ticket: '12',
        sha: SHA,
        media: [{ kind: 'still', ref: 'concept' }],
      }),
    });
    expect(response.status).toBe(422);
  });
  it('refuses a sound round when the declared capture does not exist', async () => {
    const { app, deps } = setup();
    enableTracks(deps);
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000003',
        track: 'sound',
        phase: 'cue',
        category: 'sound',
        ticket: '12',
        sha: SHA,
        media: [{ kind: 'clip', ref: `sha256:${'a'.repeat(64)}`, hasAudio: true }],
      }),
    });
    expect(response.status).toBe(422);
  });
  it('refuses a gameplay round without a real preview for its ticket and SHA', async () => {
    const { app, deps } = setup();
    enableTracks(deps);
    const response = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000002',
        track: 'game',
        phase: 'concept',
        category: 'gameplay',
        ticket: '12',
        sha: SHA,
        media: [{ kind: 'build', ref: 'preview-fake' }],
        question: 'Is it fun?',
      }),
    });
    expect(response.status).toBe(422);
  });
  it('records a verdict against the posted build and retains the prior build', async () => {
    const { deps, app, upload, answer, message } = setup();
    enableTracks(deps);
    const first = (await (await upload()).json()) as { buildId: string };
    const posted = await app.request('http://example.test/internal/games/castle-game/review-rounds', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
        track: 'game',
        phase: 'concept',
        category: 'gameplay',
        ticket: '12',
        sha: SHA,
        media: [{ kind: 'build', ref: first.buildId }],
        question: 'Is it fun?',
      }),
    });
    expect(posted.status).toBe(201);
    expect((await answer(first.buildId, '  Keep this\nexactly.  ')).status).toBe(200);
    expect(message).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.reviewRounds).get()).toMatchObject({
      verdict: 'approved',
      notes: '  Keep this\nexactly.  ',
      verdictSource: 'preview',
    });
    const before = (await (
      await app.request(`http://example.test/api/v1/games/${ids.game}/editor/previews`, { headers: asUser(ids.user) })
    ).json()) as { previews: { accessId: string }[] };
    expect((await upload()).status).toBe(201);
    expect(existsSync(join(previewDirectory(deps, ids.game, first.buildId), 'index.html'))).toBe(true);
    const history = (await (
      await app.request(`http://example.test/api/v1/games/${ids.game}/editor/preview-history`, {
        headers: asUser(ids.user),
      })
    ).json()) as { previews: { buildId: string; accessId: string }[] };
    expect(history.previews).toHaveLength(1);
    expect(history.previews[0]?.buildId).toBe(first.buildId);
    expect(history.previews[0]?.accessId).not.toBe(before.previews[0]?.accessId);
    const host = createGamesHost({
      root: deps.config.gamesRoot,
      appOrigin: 'https://app.example.test',
      version: 'test',
    });
    expect((await host.request(`/p/${ids.game}/${before.previews[0]!.accessId}/index.html`)).status).toBe(404);
    expect((await host.request(`/p/${ids.game}/${history.previews[0]!.accessId}/index.html`)).status).toBe(200);
  });
});

describe('preview builds', () => {
  it('rejects closed tickets and changed game labels', async () => {
    let state = 'open';
    let label = 'game:castle-game';
    const verify = previewTicketVerifier(
      'fixture',
      async () => new Response(JSON.stringify({ state, labels: [{ name: label }] })),
    );
    expect(await verify(REPO, '12', 'castle-game', true)).toBe(true);
    state = 'closed';
    expect(await verify(REPO, '12', 'castle-game', true)).toBe(false);
    state = 'open';
    label = 'game:other-game';
    expect(await verify(REPO, '12', 'castle-game', true)).toBe(false);
    label = '';
    const noLabel = previewTicketVerifier(
      'fixture',
      async () => new Response(JSON.stringify({ state: 'open', labels: [] })),
    );
    expect(await noLabel(REPO, '12', 'castle-game', false)).toBe(true);
    expect(await noLabel(REPO, '12', 'castle-game', true)).toBe(false);
  });
  it('publishes from a shared repository daemon workspace using its host hook', async () => {
    const { deps } = setup();
    const home = mkdtempSync(join(tmpdir(), 'preview-repo-relay-'));
    try {
      const workspace = join(home, 'workspaces', '12');
      mkdirSync(workspace, { recursive: true });
      execFileSync('git', ['init', '-q', workspace]);
      execFileSync('git', ['-C', workspace, 'remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
      const hook = fileURLToPath(new URL('../../../../scripts/preview/repository-hook.ts', import.meta.url));
      const bin = join(home, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho '{"state":"open","labels":[{"name":"game:castle-game"}]}'\n`);
      chmodSync(join(bin, 'gh'), 0o755);
      const hookOptions = {
        cwd: workspace,
        env: {
          HOME: home,
          PATH: `${bin}:/usr/bin:/bin`,
          AIUR_HOOK_TICKET_IDENTIFIER: '12',
          THIS_REPOSITORY_URL: `https://github.com/${REPO}.git`,
        },
      };
      execFileSync(process.execPath, [hook, 'create'], hookOptions);
      const token = (JSON.parse(readFileSync(join(workspace, '.gm/context/preview.json'), 'utf8')) as { token: string })
        .token;
      const dir = join(workspace, '.gm/preview');
      mkdirSync(dir);
      const id = randomUUID();
      writeFileSync(join(dir, `${id}.tgz`), archive());
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({ state: 'pending', token, ticket: '12', slug: 'castle-game', sha: SHA, branch: 'main' }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      expect(JSON.parse(readFileSync(join(dir, `${id}.response`), 'utf8')).state).toBe('done');
      const [owner, repo] = REPO.split('/');
      deps.db
        .insert(schema.games)
        .values({
          id: 'g_shared_other',
          familyId: ids.family,
          ownerId: ids.user,
          title: 'Other',
          slug: 'shared-other',
          githubPath: 'games/shared-other',
          githubOwner: owner,
          githubRepo: repo,
          visibility: 'private',
          repoVisibility: 'private',
          createdAt: '2026-11-13T00:00:00.000Z',
        })
        .run();
      const otherGame = randomUUID();
      writeFileSync(join(dir, `${otherGame}.tgz`), archive());
      writeFileSync(
        join(dir, `${otherGame}.json`),
        JSON.stringify({ state: 'pending', token, ticket: '12', slug: 'shared-other', sha: SHA, branch: 'main' }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      expect(JSON.parse(readFileSync(join(dir, `${otherGame}.response`), 'utf8')).state).toBe('failed');
      vi.useFakeTimers();
      try {
        vi.advanceTimersByTime(100 * 60 * 1000);
        await scanPreviewRelay(deps, home, async () => true);
        const refreshed = (
          JSON.parse(readFileSync(join(workspace, '.gm/context/preview.json'), 'utf8')) as { token: string }
        ).token;
        expect(refreshed).not.toBe(token);
      } finally {
        vi.useRealTimers();
      }
      const closed = randomUUID();
      writeFileSync(join(dir, `${closed}.tgz`), archive());
      writeFileSync(
        join(dir, `${closed}.json`),
        JSON.stringify({ state: 'pending', token, ticket: '12', slug: 'castle-game', sha: SHA, branch: 'main' }),
      );
      await scanPreviewRelay(deps, home, async () => false);
      expect(JSON.parse(readFileSync(join(dir, `${closed}.response`), 'utf8')).state).toBe('failed');
      execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', 'https://github.com/example/other.git']);
      execFileSync(process.execPath, [hook, 'remove'], hookOptions);
      const revoked = randomUUID();
      writeFileSync(join(dir, `${revoked}.tgz`), archive());
      writeFileSync(
        join(dir, `${revoked}.json`),
        JSON.stringify({ state: 'pending', token, ticket: '12', slug: 'castle-game', sha: SHA, branch: 'main' }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      expect(existsSync(join(dir, `${revoked}.response`))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it('publishes a scoped workspace request without network or a registered job', async () => {
    const { deps } = setup();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'castle-game',
        repo: REPO,
        checkoutPath: '/fixture',
        unit: 'fixture',
        envFile: '/fixture',
        port: 12345,
        status: 'running',
        createdAt: '2026-11-13T00:00:00.000Z',
      })
      .run();
    const home = mkdtempSync(join(tmpdir(), 'preview-relay-'));
    try {
      const secretDir = join(home, '.config/ogm/daemons/castle-game');
      mkdirSync(secretDir, { recursive: true });
      writeFileSync(join(secretDir, 'hook-secret'), SECRET);
      const dir = join(home, '.local/share/ogm/daemons/castle-game/workspaces/12/.gm/preview');
      mkdirSync(dir, { recursive: true });
      const grant = randomUUID();
      const workspace = join(dir, '..', '..');
      const grantDir = join(secretDir, 'preview-grants');
      mkdirSync(grantDir);
      const grantPath = join(grantDir, `${createHash('sha256').update(workspace).digest('hex')}.json`);
      writeFileSync(grantPath, JSON.stringify({ ticket: '12', grant }));
      const id = randomUUID();
      writeFileSync(join(dir, `${id}.tgz`), archive());
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          state: 'pending',
          token: mintPreviewToken(SECRET, '12', grant, 'castle-game'),
          ticket: '12',
          slug: 'castle-game',
          sha: SHA,
          branch: 'main',
        }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      const reply = JSON.parse(readFileSync(join(dir, `${id}.response`), 'utf8')) as {
        state: string;
        gameId: string;
        buildId: string;
      };
      expect(reply.state).toBe('done');
      expect(reply.gameId).toBe(ids.game);
      expect(existsSync(join(previewDirectory(deps, ids.game, reply.buildId), 'index.html'))).toBe(true);
      const other = randomUUID();
      writeFileSync(join(dir, `${other}.tgz`), archive());
      writeFileSync(
        join(dir, `${other}.json`),
        JSON.stringify({
          state: 'pending',
          token: mintPreviewToken(SECRET, '12', grant, 'castle-game'),
          ticket: '13',
          slug: 'castle-game',
          sha: SHA,
          branch: 'main',
        }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      expect(JSON.parse(readFileSync(join(dir, `${other}.response`), 'utf8')).state).toBe('failed');
      const [owner, repo] = REPO.split('/');
      deps.db
        .insert(schema.games)
        .values({
          id: 'g_other',
          familyId: ids.family,
          ownerId: ids.user,
          title: 'Other',
          slug: 'other-game',
          githubPath: 'games/other-game',
          githubOwner: owner,
          githubRepo: repo,
          visibility: 'private',
          repoVisibility: 'private',
          createdAt: '2026-11-13T00:00:00.000Z',
        })
        .run();
      const crossGame = randomUUID();
      writeFileSync(join(dir, `${crossGame}.tgz`), archive());
      writeFileSync(
        join(dir, `${crossGame}.json`),
        JSON.stringify({
          state: 'pending',
          token: mintPreviewToken(SECRET, '12', grant, 'castle-game'),
          ticket: '12',
          slug: 'other-game',
          sha: SHA,
          branch: 'main',
        }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      expect(JSON.parse(readFileSync(join(dir, `${crossGame}.response`), 'utf8')).state).toBe('failed');
      const anotherDir = join(home, '.local/share/ogm/daemons/castle-game/workspaces/another/.gm/preview');
      mkdirSync(anotherDir, { recursive: true });
      const replay = randomUUID();
      writeFileSync(join(anotherDir, `${replay}.tgz`), archive());
      writeFileSync(
        join(anotherDir, `${replay}.json`),
        JSON.stringify({
          state: 'pending',
          token: mintPreviewToken(SECRET, '12', grant, 'castle-game'),
          ticket: '12',
          slug: 'castle-game',
          sha: SHA,
          branch: 'main',
        }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      expect(JSON.parse(readFileSync(join(anotherDir, `${replay}.response`), 'utf8')).state).toBe('failed');
      const outside = join(home, 'outside');
      const validRequest = JSON.stringify({
        state: 'pending',
        token: mintPreviewToken(SECRET, '12', grant, 'castle-game'),
        ticket: '12',
        slug: 'castle-game',
        sha: SHA,
        branch: 'main',
      });
      writeFileSync(outside, validRequest);
      const symlink = randomUUID(),
        hardlink = randomUUID();
      symlinkSync(outside, join(dir, `${symlink}.json`));
      linkSync(outside, join(dir, `${hardlink}.json`));
      writeFileSync(join(dir, `${symlink}.tgz`), archive());
      writeFileSync(join(dir, `${hardlink}.tgz`), archive());
      await scanPreviewRelay(deps, home, async () => true);
      expect(existsSync(join(dir, `${symlink}.response`))).toBe(false);
      expect(existsSync(join(dir, `${hardlink}.response`))).toBe(false);
      expect(readFileSync(outside, 'utf8')).toBe(validRequest);
      rmSync(grantPath);
      const revoked = randomUUID();
      writeFileSync(join(dir, `${revoked}.tgz`), archive());
      writeFileSync(
        join(dir, `${revoked}.json`),
        JSON.stringify({
          state: 'pending',
          token: mintPreviewToken(SECRET, '12', grant, 'castle-game'),
          ticket: '12',
          slug: 'castle-game',
          sha: SHA,
          branch: 'main',
        }),
      );
      await scanPreviewRelay(deps, home, async () => true);
      expect(JSON.parse(readFileSync(join(dir, `${revoked}.response`), 'utf8')).state).toBe('failed');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it('verifies scoped tokens across API restarts and rejects rotation', async () => {
    const { deps } = setup();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'castle-game',
        repo: REPO,
        checkoutPath: '/fixture',
        unit: 'fixture',
        envFile: '/fixture',
        port: 12345,
        status: 'running',
        createdAt: '2026-11-13T00:00:00.000Z',
      })
      .run();
    const home = mkdtempSync(join(tmpdir(), 'preview-token-'));
    const dir = join(home, '.config/ogm/daemons/castle-game');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'hook-secret'), SECRET);
    const grant = randomUUID();
    const token = mintPreviewToken(SECRET, '12', grant, 'castle-game');
    expect(await hookPreviewToken(home)(token, deps)).toMatchObject({ repo: REPO, ticket: '12' });
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
      expect(await hookPreviewToken(home)(token, deps)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(await hookPreviewToken(home)(`${token}x`, deps)).toBeNull();
    writeFileSync(join(dir, 'hook-secret'), 'rotated');
    expect(await hookPreviewToken(home)(token, deps)).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });
  it('keeps an answered preview available to its branch with a rotated access token', async () => {
    const { deps, upload, list, editorList, answer } = setup();
    const build = (await (await upload('12', SECRET, archive(), 'branch-a')).json()) as { buildId: string };
    const before = (await (await editorList()).json()) as { previews: { branchId: string; accessId: string }[] };
    expect(before.previews[0]?.branchId).toBe('branch-a');
    expect((await answer(build.buildId)).status).toBe(200);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(0);
    const after = (await (await editorList()).json()) as { previews: { branchId: string; accessId: string }[] };
    expect(after.previews[0]?.branchId).toBe('branch-a');
    expect(after.previews[0]?.accessId).not.toBe(before.previews[0]?.accessId);
    expect(existsSync(join(previewDirectory(deps, ids.game, build.buildId), 'index.html'))).toBe(true);
    const host = createGamesHost({
      root: deps.config.gamesRoot,
      appOrigin: 'https://app.example.test',
      version: 'test',
    });
    expect((await host.request(`/p/${ids.game}/${before.previews[0]!.accessId}/index.html`)).status).toBe(404);
    expect((await host.request(`/p/${ids.game}/${after.previews[0]!.accessId}/index.html`)).status).toBe(200);
  });
  it('omits an old answered preview whose build was already removed', async () => {
    const { deps, upload, editorList, answer } = setup();
    const build = (await (await upload()).json()) as { buildId: string };
    expect((await answer(build.buildId)).status).toBe(200);
    rmSync(previewDirectory(deps, ids.game, build.buildId), { recursive: true, force: true });
    expect(((await (await editorList()).json()) as { previews: unknown[] }).previews).toEqual([]);
  });
  it('keeps the live branch untouched, serves the new build, and sends a verdict once', async () => {
    const { deps, app, upload, list, answer, message } = setup();
    expect((await upload('12', 'wrong')).status).toBe(401);
    expect((await app.request(`http://example.test/api/v1/games/${ids.game}/previews`)).status).toBe(401);
    const response = await upload();
    expect(response.status).toBe(201);
    const preview = (await response.json()) as { buildId: string };
    expect(readFileSync(join(previewDirectory(deps, ids.game, preview.buildId), 'index.html'), 'utf8')).toContain(
      'Fixture',
    );
    expect(deps.db.select().from(schema.builds).all()).toEqual([]);
    expect(
      deps.db.select().from(schema.branches).where(eq(schema.branches.id, ids.main)).get()?.latestBuildId,
    ).toBeNull();
    expect((await list()).status).toBe(200);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId)).status).toBe(200);
    expect(message).toHaveBeenCalledWith(
      '12',
      `Preview review of ${preview.buildId}: looks right.\nGreat`,
      `preview:${preview.buildId}`,
      expect.any(AbortSignal),
    );
    expect((await answer(preview.buildId)).status).toBe(409);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(0);
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('reopens on a new push and rejects a verdict for the superseded build', async () => {
    const { upload, list, answer, message } = setup();
    const first = (await (await upload()).json()) as { buildId: string };
    const second = (await (await upload()).json()) as { buildId: string };
    expect(second.buildId).not.toBe(first.buildId);
    expect((await answer(first.buildId)).status).toBe(409);
    expect(message).not.toHaveBeenCalled();
    expect(
      ((await (await list()).json()) as { previews: { buildId: string }[] }).previews.map((p) => p.buildId),
    ).toEqual([second.buildId]);
    expect((await answer(second.buildId)).status).toBe(200);
    expect((await upload()).status).toBe(201);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
  });

  it('keeps a failed delivery in the queue', async () => {
    const { upload, list, answer, message } = setup();
    const preview = (await (await upload()).json()) as { buildId: string };
    message.mockRejectedValueOnce(new Error('offline'));
    expect((await answer(preview.buildId)).status).toBe(500);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId)).status).toBe(200);
  });

  it('keeps an uncertain delivery open for an idempotent retry', async () => {
    const { upload, list, answer, message } = setup();
    const preview = (await (await upload()).json()) as { buildId: string };
    message.mockResolvedValueOnce({ warning: 'outcome_unknown' });
    expect((await answer(preview.buildId)).status).toBe(500);
    expect(((await (await list()).json()) as { previews: unknown[] }).previews).toHaveLength(1);
    expect((await answer(preview.buildId, 'Changed')).status).toBe(409);
    expect(message).toHaveBeenCalledTimes(1);
    expect((await answer(preview.buildId)).status).toBe(200);
    expect(message.mock.calls[0]?.[2]).toBe(message.mock.calls[1]?.[2]);
  });
  it('protects preview files and private cache-plan assets with a revocable capability', async () => {
    const { deps, upload, list } = setup();
    const files = builtFiles();
    const bytes = Buffer.from('preview image');
    const hash = createHash('sha256').update(bytes).digest('hex');
    mkdirSync(join(files, 'a'));
    writeFileSync(join(files, 'a', `${hash}.png`), bytes);
    writeFileSync(
      join(files, 'assets', 'manifest.json'),
      JSON.stringify({ files: { [`/a/${hash}.png`]: {} }, assets: { hero: { file: { '*': `/a/${hash}.png` } } } }),
    );
    const phase = () => ({
      boot: { bytes: 0, files: 0 },
      ready: { bytes: bytes.length, files: 1 },
      stream: { bytes: 0, files: 0 },
    });
    writeFileSync(
      join(files, 'assets', 'cache-plan.json'),
      JSON.stringify({
        version: 1,
        gameId: '',
        buildId: '',
        built: '2026-11-02T20:00:00.000Z',
        sdkVersion: '',
        tiers: ['desktop'],
        entries: [
          { sha256: hash, url: `/a/${hash}.png`, bytes: bytes.length, kind: 'sprite', phase: 'ready', tiers: ['*'] },
        ],
        totals: { desktop: phase(), mobile: phase(), low: phase() },
      }),
    );
    const body = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', files, '.']);
    const response = await upload('12', SECRET, body);
    expect(response.status).toBe(201);
    const preview = (await response.json()) as { buildId: string; accessId?: string };
    expect(preview.accessId).toBeUndefined();
    const accessId = ((await (await list()).json()) as { previews: { accessId: string }[] }).previews[0]!.accessId;
    expect(existsSync(join(deps.config.gamesRoot, '_a', `${hash}.png`))).toBe(false);
    expect(readFileSync(join(previewDirectory(deps, ids.game, preview.buildId), 'a', `${hash}.png`))).toEqual(bytes);
    const host = createGamesHost({
      root: deps.config.gamesRoot,
      appOrigin: 'https://app.example.test',
      version: 'test',
      workerScript: '/missing',
    });
    expect((await host.request(`/g/${ids.game}/${preview.buildId}/index.html`)).status).toBe(404);
    expect((await host.request(`/a/${hash}.png`)).status).toBe(404);
    const url = `/p/${ids.game}/${accessId}`;
    const image = await host.request(`${url}/a/${hash}.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get('cache-control')).toBe('no-store');
    expect(image.headers.get('access-control-allow-origin')).toBe('*');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
    const assetManifest = (await (await host.request(`${url}/assets/manifest.json`)).json()) as {
      assets: { hero: { file: Record<string, string> } };
    };
    expect(assetManifest.assets.hero.file['*']).toBe(`../a/${hash}.png`);
    const cachePlan = (await (await host.request(`${url}/assets/cache-plan.json`)).json()) as {
      entries: { url: string }[];
    };
    expect(cachePlan.entries.some((entry) => entry.url === `../a/${hash}.png`)).toBe(true);
    const html = await host.request(`${url}/index.html`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('<script src="./__ogm_preview_bootstrap.js"></script>');
    const bootstrap = await host.request(`${url}/__ogm_preview_bootstrap.js`);
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get('cache-control')).toBe('no-store');
    expect(bootstrap.headers.get('access-control-allow-origin')).toBe('*');
    expect(await bootstrap.text()).toContain("Object.defineProperty(navigator, 'locks'");
    const metadataPath = join(deps.config.gamesRoot, '.previews', ids.game, '12.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, accessExpiresAt: '2000-01-01T00:00:00.000Z' }));
    expect((await host.request(`${url}/index.html`)).status).toBe(404);
    expect((await host.request(`${url}/__ogm_preview_bootstrap.js`)).status).toBe(404);
    const renewed = ((await (await list()).json()) as { previews: { accessId: string }[] }).previews[0]!.accessId;
    expect(renewed).not.toBe(accessId);
    expect((await host.request(`/p/${ids.game}/${renewed}/index.html`)).status).toBe(200);
    expect((await upload()).status).toBe(201);
    expect((await host.request(`/p/${ids.game}/${renewed}/index.html`)).status).toBe(404);
  });
  it('keeps preview upload and daemon routing working after the game is renamed', async () => {
    const { deps, upload } = setup();
    deps.db
      .insert(schema.gameDaemons)
      .values({
        slug: 'castle-game',
        repo: REPO,
        checkoutPath: '/fixture',
        unit: 'fixture',
        envFile: '/fixture',
        port: 12345,
        status: 'running',
        createdAt: '2026-11-13T00:00:00.000Z',
      })
      .run();
    deps.db
      .insert(schema.gameSlugs)
      .values({ slug: 'castle-game', gameId: ids.game, createdAt: '2026-11-13T00:00:00.000Z' })
      .run();
    deps.db.update(schema.games).set({ slug: 'new-name' }).where(eq(schema.games.id, ids.game)).run();
    expect(daemonRowForGame(deps.db, ids.game)?.slug).toBe('castle-game');
    expect((await upload()).status).toBe(201);
  });
});
