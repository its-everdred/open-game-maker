import { readFileSync } from 'node:fs';

import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';
import { insertChatRow } from '../../src/build-chat/store.js';
import { sweepExpiredDrafts } from '../../src/game-drafts/cleanup.js';
import { createGameRow } from '../../src/games/games.js';
import { gameDrafts } from '../../src/new-game/drafts.js';

const user = {
  kind: 'user' as const,
  userId: 'u_draft-owner',
  familyId: 'f_draft-family',
  platformRole: 'none' as const,
  capability: 'creator' as const,
  email: 'owner@example.test',
};
const choices = {
  genre: 'platformer',
  vibe: 'cozy',
  family: 'chunky-low-poly',
  world: 'floating islands',
  players: 'single',
  pov: 'isometric',
};
const agreed = JSON.parse(
  readFileSync(new URL('../../../../packages/contracts/fixtures/scope/agreed.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

async function setup() {
  const deps = makeDeps();
  const at = '2026-11-20T12:00:00.000Z';
  deps.db
    .insert(schema.families)
    .values({ id: user.familyId, name: 'Family', ownerUserId: user.userId, createdAt: at })
    .run();
  installUsers(deps, [user]);
  let latestDraftId = '';
  const create = vi.fn(async ({ draftId }: { draftId: string }) => {
    latestDraftId = draftId;
    return { repo: 'owner/instance', ticket: '42' };
  });
  const close = vi.fn().mockResolvedValue(undefined);
  const transcript = vi.fn(async () => [
    { body: `\`\`\`ogm-scope\n${JSON.stringify({ ...agreed, session_id: latestDraftId })}\n\`\`\``, turn_id: 'turn-1' },
  ]);
  deps.registry.draftScopeAssistant = { create, close, transcript };
  return { deps, create, close, ...(await makeApp(deps)) };
}

describe('temporary game drafts', () => {
  it('rejects a player before starting the assistant and permits the same account after promotion', async () => {
    const { deps, app, create } = await setup();
    const player = { ...user, userId: 'u_draft-player', email: 'player@example.test', capability: 'player' as const };
    installUsers(deps, [player]);
    deps.db
      .insert(schema.familyMembers)
      .values({
        familyId: user.familyId,
        userId: player.userId,
        role: 'member',
        capability: 'player',
        joinedAt: '2026-11-20',
      })
      .run();
    const request = () =>
      app.request('/api/v1/game-drafts', {
        method: 'POST',
        headers: { ...asUser(player.userId), 'content-type': 'application/json' },
        body: JSON.stringify({ choices }),
      });
    expect((await request()).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    deps.sqlite.prepare('UPDATE family_members SET capability = ? WHERE user_id = ?').run('creator', player.userId);
    expect((await request()).status).toBe(201);
    expect(create).toHaveBeenCalledOnce();
  });

  it('creates a family for a familyless maker before starting the draft', async () => {
    const { deps, app } = await setup();
    const maker = { ...user, userId: 'u_new-maker', email: 'maker@example.test', familyId: '' };
    installUsers(deps, [maker]);
    const response = await app.request('/api/v1/game-drafts', {
      method: 'POST',
      headers: { ...asUser(maker.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ choices }),
    });
    expect(response.status).toBe(201);
    expect(
      deps.sqlite.prepare('SELECT family_id FROM family_members WHERE user_id = ?').get(maker.userId),
    ).toBeDefined();
  });
  it('starts scope chat without creating a games row or per-game daemon', async () => {
    const { deps, app, create } = await setup();
    const response = await app.request('/api/v1/game-drafts', {
      method: 'POST',
      headers: { ...asUser(user.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ choices, allowAiGeneratedAssets: false }),
    });

    expect(response.status).toBe(201);
    const result = (await response.json()) as { draftId: string; jobId: string };
    expect(result.jobId).toBe(`draft:${result.draftId}`);
    expect(deps.db.select().from(schema.games).all()).toEqual([]);
    expect(deps.db.select().from(schema.gameDaemons).all()).toEqual([]);
    expect(create).toHaveBeenCalledWith({ draftId: result.draftId, choices });
  });

  it('deletes a draft and closes its shared scope ticket when the creator leaves', async () => {
    const { deps, app, close } = await setup();
    const started = await app.request('/api/v1/game-drafts', {
      method: 'POST',
      headers: { ...asUser(user.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ choices }),
    });
    const { draftId } = (await started.json()) as { draftId: string };

    const response = await app.request(`/api/v1/game-drafts/${draftId}/abandon`, {
      method: 'POST',
      headers: asUser(user.userId),
    });

    expect(response.status).toBe(204);
    expect(deps.db.select().from(schema.gameDrafts).all()).toEqual([]);
    expect(close).toHaveBeenCalledWith({ repo: 'owner/instance', ticket: '42', draftId });
  });

  it('keeps a cleanup handle when assistant creation and immediate close both fail', async () => {
    const { deps, app, create, close } = await setup();
    create.mockRejectedValueOnce(new Error('dispatch failed'));
    close.mockRejectedValueOnce(new Error('close failed'));

    const response = await app.request('/api/v1/game-drafts', {
      method: 'POST',
      headers: { ...asUser(user.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ choices }),
    });

    expect(response.status).toBe(503);
    const [draft] = deps.db.select().from(schema.gameDrafts).all();
    expect(draft).toMatchObject({ ticketRepo: 'instance/games', ticketNumber: null });
    expect(close).toHaveBeenCalledWith({ repo: 'instance/games', draftId: draft!.id });
  });

  it('sweeps expired drafts after closing their shared assistant ticket', async () => {
    const { deps, close } = await setup();
    const expiredAt = new Date('2026-11-19T12:00:00.000Z');
    const draft = gameDrafts.create(deps.db, {
      familyId: user.familyId,
      creatorId: user.userId,
      choices,
      allowAiGeneratedAssets: true,
      at: expiredAt,
    });
    gameDrafts.attachTicket(deps.db, draft.id, 'owner/instance', 42, expiredAt.toISOString());
    const jobId = `draft:${draft.id}`;
    insertChatRow(deps.sqlite, { id: 'm_expired', jobId, actor: 'creator', kind: 'text', text: 'temporary scope' });
    deps.sqlite
      .prepare('INSERT INTO build_chat_workspaces (workspace_root, job_id, pinned_at) VALUES (?, ?, ?)')
      .run('/tmp/expired-draft', jobId, '2026-11-19T12:00:00.000Z');
    deps.sqlite
      .prepare(
        'INSERT INTO build_chat_attachments (id, job_id, creator_id, kind, name, mime, blob_hash, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'a_expired',
        jobId,
        user.userId,
        'text',
        'scope.txt',
        'text/plain',
        'blob_hash',
        1,
        '2026-11-19T12:00:00.000Z',
      );

    const promotedDraft = gameDrafts.create(deps.db, {
      familyId: user.familyId,
      creatorId: user.userId,
      choices,
      allowAiGeneratedAssets: true,
      at: expiredAt,
    });
    gameDrafts.attachTicket(deps.db, promotedDraft.id, 'owner/instance', 43, expiredAt.toISOString());
    gameDrafts.agree(deps.db, promotedDraft.id, { ...agreed, session_id: promotedDraft.id }, expiredAt.toISOString());
    const game = createGameRow(deps.db, {
      familyId: user.familyId,
      ownerId: user.userId,
      title: 'Finished bakery',
      repoVisibility: 'private',
    });
    gameDrafts.attachGame(deps.db, promotedDraft.id, game.id, expiredAt.toISOString());
    gameDrafts.complete(deps.db, promotedDraft.id, expiredAt.toISOString());
    const promotedJobId = `draft:${promotedDraft.id}`;
    insertChatRow(deps.sqlite, {
      id: 'm_promoted',
      jobId: promotedJobId,
      actor: 'creator',
      kind: 'text',
      text: 'Keep the lanterns bright.',
    });

    const attachedDraft = gameDrafts.create(deps.db, {
      familyId: user.familyId,
      creatorId: user.userId,
      choices,
      allowAiGeneratedAssets: true,
      at: expiredAt,
    });
    gameDrafts.attachTicket(deps.db, attachedDraft.id, 'owner/instance', 44, expiredAt.toISOString());
    gameDrafts.agree(deps.db, attachedDraft.id, { ...agreed, session_id: attachedDraft.id }, expiredAt.toISOString());
    const attachedGame = createGameRow(deps.db, {
      familyId: user.familyId,
      ownerId: user.userId,
      title: 'Attached bakery',
      repoVisibility: 'private',
    });
    gameDrafts.attachGame(deps.db, attachedDraft.id, attachedGame.id, expiredAt.toISOString());

    await sweepExpiredDrafts(deps, new Date('2026-11-20T13:00:00.000Z'));
    await sweepExpiredDrafts(deps, new Date('2026-11-20T13:01:00.000Z'));

    expect(close).toHaveBeenCalledWith({ repo: 'owner/instance', ticket: '42', draftId: draft.id });
    expect(close).toHaveBeenCalledWith({ repo: 'owner/instance', ticket: '43', draftId: promotedDraft.id });
    expect(close).toHaveBeenCalledWith({ repo: 'owner/instance', ticket: '44', draftId: attachedDraft.id });
    expect(close).toHaveBeenCalledTimes(3);
    expect(deps.db.select().from(schema.gameDrafts).all()).toMatchObject([
      { id: promotedDraft.id, status: 'promoted', gameId: game.id, ticketRepo: null, ticketNumber: null },
      { id: attachedDraft.id, status: 'agreed', gameId: attachedGame.id, ticketRepo: null, ticketNumber: null },
    ]);
    expect(
      deps.db
        .select()
        .from(schema.games)
        .all()
        .map(({ id }) => id),
    ).toEqual([game.id, attachedGame.id]);
    expect(deps.sqlite.prepare('SELECT id FROM build_chat_messages').all()).toEqual([{ id: 'm_promoted' }]);
    expect(deps.sqlite.prepare('SELECT id FROM build_chat_attachments').all()).toEqual([]);
    expect(deps.sqlite.prepare('SELECT workspace_root FROM build_chat_workspaces').all()).toEqual([]);
  });

  it('keeps an expired draft when ticket closure fails so a later sweep can retry', async () => {
    const { deps, close } = await setup();
    const draft = gameDrafts.create(deps.db, {
      familyId: user.familyId,
      creatorId: user.userId,
      choices,
      allowAiGeneratedAssets: true,
      at: new Date('2026-11-19T12:00:00.000Z'),
    });
    gameDrafts.attachTicket(deps.db, draft.id, 'owner/instance', 42, '2026-11-19T12:00:00.000Z');
    close.mockRejectedValueOnce(new Error('close unavailable'));

    await sweepExpiredDrafts(deps, new Date('2026-11-20T13:00:00.000Z'));

    expect(deps.db.select().from(schema.gameDrafts).all()).toHaveLength(1);
    await sweepExpiredDrafts(deps, new Date('2026-11-20T13:01:00.000Z'));
    expect(deps.db.select().from(schema.gameDrafts).all()).toEqual([]);
  });

  it('stores an agreed scope from the shared assistant before any game exists', async () => {
    const { deps, app } = await setup();
    const started = await app.request('/api/v1/game-drafts', {
      method: 'POST',
      headers: { ...asUser(user.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ choices }),
    });
    const { draftId } = (await started.json()) as { draftId: string };

    const response = await app.request(`/api/v1/game-drafts/${draftId}`, { headers: asUser(user.userId) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessionId: draftId,
      status: 'agreed',
      scope: { session_id: draftId },
    });
    expect(deps.db.select().from(schema.games).all()).toEqual([]);
  });

  it('promotes a finished draft idempotently and refuses to abandon it', async () => {
    const { deps, app, close } = await setup();
    const started = await app.request('/api/v1/game-drafts', {
      method: 'POST',
      headers: { ...asUser(user.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ choices }),
    });
    const { draftId } = (await started.json()) as { draftId: string };
    expect((await app.request(`/api/v1/game-drafts/${draftId}`, { headers: asUser(user.userId) })).status).toBe(200);
    const game = createGameRow(deps.db, {
      familyId: user.familyId,
      ownerId: user.userId,
      title: 'Moonlit Bakery',
      repoVisibility: 'private',
    });
    const attach = () =>
      app.request(`/api/v1/game-drafts/${draftId}/attach-game`, {
        method: 'POST',
        headers: { ...asUser(user.userId), 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: game.id }),
      });

    expect((await attach()).status).toBe(200);
    expect(
      (await app.request(`/api/v1/game-drafts/${draftId}/complete`, { method: 'POST', headers: asUser(user.userId) }))
        .status,
    ).toBe(204);
    expect((await attach()).status).toBe(200);
    expect(
      (await app.request(`/api/v1/game-drafts/${draftId}/complete`, { method: 'POST', headers: asUser(user.userId) }))
        .status,
    ).toBe(204);
    expect(
      (await app.request(`/api/v1/game-drafts/${draftId}/abandon`, { method: 'POST', headers: asUser(user.userId) }))
        .status,
    ).toBe(409);
    expect(gameDrafts.get(deps.db, draftId)).toMatchObject({ status: 'promoted', gameId: game.id });
    expect(close).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.games).all()).toHaveLength(1);
  });

  it('preserves draft context when Finish attaches a game during abandonment cleanup', async () => {
    const { deps, app, close } = await setup();
    const started = await app.request('/api/v1/game-drafts', {
      method: 'POST',
      headers: { ...asUser(user.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ choices }),
    });
    const { draftId } = (await started.json()) as { draftId: string };
    gameDrafts.agree(deps.db, draftId, { ...agreed, session_id: draftId });
    insertChatRow(deps.sqlite, {
      id: 'm_racing_finish',
      jobId: `draft:${draftId}`,
      actor: 'creator',
      kind: 'text',
      text: 'Build a moonlit bakery.',
    });

    let finishClose!: () => void;
    const closing = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    close.mockReturnValueOnce(closing);
    const abandoning = app.request(`/api/v1/game-drafts/${draftId}/abandon`, {
      method: 'POST',
      headers: asUser(user.userId),
    });
    await vi.waitFor(() => expect(close).toHaveBeenCalled());

    const game = createGameRow(deps.db, {
      familyId: user.familyId,
      ownerId: user.userId,
      title: 'Moonlit bakery',
      repoVisibility: 'private',
    });
    gameDrafts.attachGame(deps.db, draftId, game.id);
    finishClose();

    expect((await abandoning).status).toBe(204);
    expect(gameDrafts.get(deps.db, draftId)).toMatchObject({
      status: 'agreed',
      gameId: game.id,
      ticketRepo: null,
      ticketNumber: null,
    });
    expect(deps.sqlite.prepare('SELECT text FROM build_chat_messages').all()).toEqual([
      { text: 'Build a moonlit bakery.' },
    ]);
    expect(
      (
        await app.request(`/api/v1/game-drafts/${draftId}/complete`, {
          method: 'POST',
          headers: asUser(user.userId),
        })
      ).status,
    ).toBe(204);
    expect(gameDrafts.get(deps.db, draftId)).toMatchObject({ status: 'promoted', gameId: game.id });
  });
});
