import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { claimAttachments, storeAttachment } from '../../src/build-chat/attachments.js';
import { insertChatRow } from '../../src/build-chat/store.js';
import { newGameContext } from '../../src/new-game/context.js';
import { sweepExpiredDrafts } from '../../src/game-drafts/cleanup.js';
import { contextTokenSecret, signContextToken } from '../../src/new-game/token.js';
import { asUser, installUsers, makeApp, makeDeps, INTERNAL_TOKEN } from '../helpers.js';

const NOW = '2026-11-04T18:00:00.000Z';
const GAME = 'g_47500000-0000-4000-8000-000000000001';
const SCOPE_JOB = 'j_47500000-0000-4000-8000-000000000002';
const REQUEST = 'j_47500000-0000-4000-8000-000000000003';
const OTHER_REQUEST = 'j_47500000-0000-4000-8000-000000000004';
const SESSION = 's_47500000-0000-4000-8000-000000000005';
const FAMILY = 'f_47500000-0000-4000-8000-000000000006';
const CREATOR = 'u_47500000-0000-4000-8000-000000000007';
const SCOPE = {
  session_id: SESSION,
  revision: 1,
  title: 'Lantern Bay',
  summary: 'A cozy island platformer about relighting harbour lanterns.',
  scope: { included: ['lanterns'], excluded: ['multiplayer'] },
  tickets: [
    { key: 'T1', title: 'Light the harbour', skills: ['gm-core'], dependsOn: [], acceptanceCriteria: ['it glows'] },
  ],
  complexity: 3,
  open_questions: [],
  ideas: [],
};

function seedJob(id: string, kind: 'new_game' | 'feature' | 'scope', extra: Record<string, unknown> = {}) {
  return {
    id,
    gameId: GAME,
    branchId: 'main',
    familyId: FAMILY,
    creatorId: CREATOR,
    kind,
    complexity: kind === 'scope' ? 1 : 3,
    state: 'filed' as const,
    start: 'now' as const,
    slot: kind === 'new_game' ? ('new_game' as const) : ('edit' as const),
    plan: JSON.stringify({
      title: 'Lantern Bay',
      summary: 'A cozy island platformer about relighting harbour lanterns.',
      scope: { included: ['lanterns'], excluded: ['multiplayer'] },
      tickets: [{ key: 'T1', skills: ['gm-core'], dependsOn: [], acceptanceCriteria: ['it glows'] }],
    }),
    reservation: JSON.stringify({ amountMicroUsd: 9_000_001, sizeClass: 'large', confidence: 'low' }),
    hardCapMicroUsd: 12_000_000,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

async function setup() {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({
      id: FAMILY,
      name: 'Family',
      ownerUserId: CREATOR,
      createdAt: NOW,
    })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: GAME,
      familyId: FAMILY,
      ownerId: CREATOR,
      title: 'Lantern Bay',
      slug: 'lantern-bay',
      visibility: 'private',
      githubOwner: 'owner',
      githubRepo: 'game',
      repoVisibility: 'private',
      repoUrl: 'https://github.com/owner/game',
      createdAt: NOW,
    })
    .run();
  deps.db.insert(schema.jobs).values(seedJob(SCOPE_JOB, 'scope')).run();
  deps.db
    .insert(schema.jobs)
    .values(seedJob(REQUEST, 'new_game', { aiurRepo: 'owner/game', aiurIssueNumber: 12 }))
    .run();
  deps.db
    .insert(schema.jobs)
    .values(seedJob(OTHER_REQUEST, 'new_game', { aiurRepo: 'owner/game', aiurIssueNumber: 13 }))
    .run();
  deps.db.insert(schema.jobs).values(seedJob('j_47500000-0000-4000-8000-000000000009', 'feature')).run();
  deps.db
    .insert(schema.scopeSessions)
    .values({
      id: SESSION,
      gameId: GAME,
      creatorId: CREATOR,
      jobId: SCOPE_JOB,
      status: 'agreed',
      revision: 1,
      choices: JSON.stringify({
        genre: 'platformer',
        vibe: 'cozy',
        family: 'chunky-low-poly',
        world: 'floating islands',
        players: 'single',
        pov: 'isometric',
      }),
      scope: JSON.stringify(SCOPE),
      scopeHash: 'a'.repeat(64),
      createdAt: '2026-11-04T17:50:00.000Z',
      updatedAt: NOW,
    })
    .run();
  deps.db
    .insert(schema.scopeSessionRevisions)
    .values({ sessionId: SESSION, revision: 1, scope: JSON.stringify(SCOPE), scopeHash: 'a'.repeat(64), agreedAt: NOW })
    .run();
  insertChatRow(deps.sqlite, {
    jobId: SCOPE_JOB,
    actor: 'creator',
    kind: 'text',
    text: 'I want the lanterns to matter.',
  });
  // A voice turn lands in the chat as text, never as audio.
  const voice = insertChatRow(deps.sqlite, {
    jobId: SCOPE_JOB,
    actor: 'creator',
    kind: 'text',
    text: 'Keep it calm at dusk.',
  });
  const attachment = await storeAttachment(deps.sqlite, deps.blobStore, {
    jobId: SCOPE_JOB,
    creatorId: CREATOR,
    type: 'text/markdown',
    name: 'mood-board.md',
    bytes: new TextEncoder().encode('# dusk\n'),
  });
  claimAttachments(deps.sqlite, {
    ids: [attachment.id],
    jobId: SCOPE_JOB,
    creatorId: CREATOR,
    messageId: voice.row!.id,
  });
  const server = await makeApp(deps);
  installUsers(deps, [
    {
      kind: 'user',
      userId: CREATOR,
      displayName: 'Creator',
      familyId: FAMILY,
      platformRole: 'none',
      capability: 'creator',
      email: 'creator@example.test',
    },
  ]);
  const get = (path: string, headers: Record<string, string> = {}) =>
    server.app.request(`http://127.0.0.1:4000${path}`, { headers });
  const scoped = (requestId = REQUEST, secret = contextTokenSecret(deps.config.jobTokenSecret)) =>
    signContextToken({ request: requestId, game: GAME }, secret).token;
  return { deps, server, get, scoped, attachment };
}

describe('GET /internal/new-game/requests/:requestId', () => {
  it('refuses a request without an authorised token', async () => {
    const { get } = await setup();
    expect((await get(`/internal/new-game/requests/${REQUEST}`)).status).toBe(401);
    expect((await get(`/internal/new-game/requests/${REQUEST}`, { authorization: 'Bearer nope' })).status).toBe(401);
    // A signed-in creator's session is not an authorised agent: the raw scope chat stays behind the internal token.
    expect((await get(`/internal/new-game/requests/${REQUEST}`, asUser(CREATOR))).status).toBe(401);
  });

  it('returns the private context to a scoped token for this request only', async () => {
    const { get, scoped } = await setup();
    const response = await get(`/internal/new-game/requests/${REQUEST}`, { authorization: `Bearer ${scoped()}` });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      request: REQUEST,
      game: { id: GAME, title: 'Lantern Bay', slug: 'lantern-bay' },
      choices: { genre: 'platformer', world: 'floating islands' },
      parent: { repo: 'owner/game', number: 12 },
    });
    expect(body.spec.title).toBe('Lantern Bay');
    expect(body.revisions).toEqual([{ revision: 1, agreedAt: NOW }]);
    expect(body.messages.map((message: { text: string }) => message.text)).toEqual([
      'I want the lanterns to matter.',
      'Keep it calm at dusk.',
    ]);
    expect(body.attachments).toEqual([
      expect.objectContaining({ kind: 'text', name: 'mood-board.md', mime: 'text/markdown' }),
    ]);

    const foreign = await get(`/internal/new-game/requests/${REQUEST}`, {
      authorization: `Bearer ${scoped(OTHER_REQUEST)}`,
    });
    expect(foreign.status).toBe(403);
  });

  it('serves the internal token the Executor carries', async () => {
    const { get } = await setup();
    const response = await get(`/internal/new-game/requests/${REQUEST}`, { 'x-ogm-internal': INTERNAL_TOKEN });
    expect(response.status).toBe(200);
  });

  it('does not treat an ordinary job as a request', async () => {
    const { get } = await setup();
    expect((await get('/internal/new-game/requests/j_47500000-0000-4000-8000-000000000009')).status).toBe(401);
    expect(
      (
        await get('/internal/new-game/requests/j_47500000-0000-4000-8000-000000000009', {
          'x-ogm-internal': INTERNAL_TOKEN,
        })
      ).status,
    ).toBe(404);
  });

  it('serves a pasted attachment to the request token and refuses another request token', async () => {
    const { get, scoped, attachment } = await setup();
    const path = `/internal/new-game/requests/${REQUEST}/attachments/${attachment.id}`;
    expect((await get(path)).status).toBe(401);

    const response = await get(path, { authorization: `Bearer ${scoped()}` });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toBe('# dusk\n');

    const foreign = await get(path, { authorization: `Bearer ${scoped(OTHER_REQUEST)}` });
    expect(foreign.status).toBe(403);
  });
});

describe('POST /internal/new-game/requests/:requestId/token', () => {
  it('mints a scoped token only for the internal credential', async () => {
    const { get, server, deps } = await setup();
    const post = (headers: Record<string, string> = {}) =>
      server.app.request(`http://127.0.0.1:4000/internal/new-game/requests/${REQUEST}/token`, {
        method: 'POST',
        headers,
      });

    expect((await post()).status).toBe(401);

    const minted = await post({ 'x-ogm-internal': INTERNAL_TOKEN });
    expect(minted.status).toBe(201);
    const body = (await minted.json()) as { token: string; request: string; game: string; expiresAt: string };
    expect(body).toMatchObject({ request: REQUEST, game: GAME });

    const read = await get(`/internal/new-game/requests/${REQUEST}`, { authorization: `Bearer ${body.token}` });
    expect(read.status).toBe(200);
    // The minted token is scoped to this request: it opens nothing else.
    const elsewhere = await get(`/internal/new-game/requests/${OTHER_REQUEST}`, {
      authorization: `Bearer ${body.token}`,
    });
    expect(elsewhere.status).toBe(403);
    expect(contextTokenSecret(deps.config.jobTokenSecret)).not.toBe('');
  });

  it('includes the promoted draft scope and chat when building the game request context', async () => {
    const { deps } = await setup();
    const close = vi.fn(async () => undefined);
    deps.registry.draftScopeAssistant = {
      create: vi.fn(async () => ({ repo: 'owner/game', ticket: '42' })),
      close,
      transcript: vi.fn(async () => []),
    };
    deps.db.delete(schema.scopeSessionRevisions).run();
    deps.db.delete(schema.scopeSessions).run();
    const draftId = 'd_47500000-0000-4000-8000-000000000010';
    const scope = { ...SCOPE, session_id: draftId };
    deps.db
      .insert(schema.gameDrafts)
      .values({
        id: draftId,
        familyId: FAMILY,
        creatorId: CREATOR,
        choices: JSON.stringify({
          genre: 'platformer',
          vibe: 'cozy',
          family: 'chunky-low-poly',
          world: 'island',
          players: 'single',
          pov: 'isometric',
        }),
        allowAiGeneratedAssets: true,
        status: 'promoted',
        revision: 1,
        ticketRepo: 'owner/game',
        ticketNumber: 42,
        scope: JSON.stringify(scope),
        scopeHash: 'b'.repeat(64),
        gameId: GAME,
        createdAt: '2026-11-04T17:49:00.000Z',
        updatedAt: NOW,
        expiresAt: '2026-11-05T17:49:00.000Z',
      })
      .run();
    insertChatRow(deps.sqlite, {
      jobId: `draft:${draftId}`,
      actor: 'creator',
      kind: 'text',
      text: 'A lighthouse too.',
    });

    await sweepExpiredDrafts(deps, new Date('2026-11-06T18:00:00.000Z'));

    const context = newGameContext(deps.db, deps.sqlite, REQUEST);

    expect(context).toMatchObject({ choices: { genre: 'platformer' }, spec: { session_id: draftId } });
    expect(context?.messages).toContainEqual(expect.objectContaining({ text: 'A lighthouse too.' }));
    expect(close).toHaveBeenCalledWith({ repo: 'owner/game', ticket: '42', draftId });
    expect(deps.db.select().from(schema.gameDrafts).all()).toMatchObject([{ id: draftId, gameId: GAME }]);
  });
});
