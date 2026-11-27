import { AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { asUser, installUsers, makeApp, makeDeps } from './helpers.js';

// The core daemon is mocked with aiur#8034's shapes until the thread API ships.
const ids = {
  family: 'f_85400000-0000-4000-8000-000000000001',
  owner: 'u_85400000-0000-4000-8000-000000000001',
  creator: 'u_85400000-0000-4000-8000-000000000002',
  game: 'g_85400000-0000-4000-8000-000000000001',
};
const AT = '2026-11-18T05:00:00.000Z';

async function setup(client: Partial<AiurClient>) {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.owner, createdAt: AT })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.owner,
      title: 'Blobs',
      slug: 'blobs',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: AT,
    })
    .run();
  deps.db
    .insert(schema.branches)
    .values({
      id: 'b_main',
      gameId: ids.game,
      name: 'main',
      gitRef: 'main',
      status: 'active',
      latestBuildId: 'bld_42',
      createdBy: ids.owner,
      createdAt: AT,
    })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.owner,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'o@example.test',
    },
    {
      kind: 'user',
      userId: ids.creator,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'c@example.test',
    },
  ]);
  deps.config.instanceOwnerId = ids.owner;
  deps.registry.coreAiurClient = client as AiurClient;
  return makeApp(deps);
}

const reply = {
  id: 'pos_3',
  pos: 3,
  request_id: null,
  role: 'executor' as const,
  text: 'Here are two looks.',
  attachments: [
    { kind: 'image', mime_type: 'image/png', attachment_id: 'att_1' },
    { kind: 'video', mime_type: 'video/mp4', locator: { kind: 'attachment', attachment_id: 'att_2' } },
    { kind: 'image', mime_type: 'image/png', locator: { kind: 'url', value: 'https://elsewhere.example/a.png' } },
  ],
  created_at: AT,
  delivery: null,
};

describe('executor thread', () => {
  it('rejects the instance owner after demotion to player', async () => {
    const executorThreadMessages = vi.fn();
    const { app, deps } = await setup({ executorThreadMessages });
    deps.db
      .insert(schema.familyMembers)
      .values({ familyId: ids.family, userId: ids.owner, role: 'owner', capability: 'player', joinedAt: AT })
      .run();
    expect((await app.request('/api/v1/me/executor/thread/messages', { headers: asUser(ids.owner) })).status).toBe(403);
    expect(executorThreadMessages).not.toHaveBeenCalled();
  });
  // The Executor is the instance owner's operator: no other creator, even in the same family, reads or writes it.
  it('answers only the instance owner', async () => {
    const executorThreadMessages = vi.fn();
    const { app } = await setup({ executorThreadMessages });
    const response = await app.request('/api/v1/me/executor/thread/messages', { headers: asUser(ids.creator) });
    expect(response.status).toBe(403);
    expect(executorThreadMessages).not.toHaveBeenCalled();
  });

  it('lists replies with their media served through the app, never an outside URL', async () => {
    const executorThreadMessages = vi.fn().mockResolvedValue({ messages: [reply], next_after: 3, queued: [] });
    const { app } = await setup({ executorThreadMessages });
    const response = await app.request('/api/v1/me/executor/thread/messages?after=2', { headers: asUser(ids.owner) });
    expect(executorThreadMessages).toHaveBeenCalledWith(2, 100, expect.any(AbortSignal));
    const page = await response.json();
    expect(page.next_after).toBe(3);
    expect(page.messages[0].attachments).toEqual([
      { id: 'att_1', kind: 'image', mime: 'image/png', url: '/api/v1/me/executor/thread/attachments/att_1' },
      { id: 'att_2', kind: 'video', mime: 'video/mp4', url: '/api/v1/me/executor/thread/attachments/att_2' },
    ]);
  });

  // "The current game, screen and build go with it automatically" (#854 Ask): the Executor reads them in the text.
  it('sends the ask with the game, its build and the screen the creator was on', async () => {
    const sendExecutorThreadMessage = vi.fn().mockResolvedValue({
      id: 'req_1',
      pos: null,
      request_id: 1,
      role: 'operator',
      text: 'x',
      attachments: [],
      created_at: AT,
      delivery: 'queued',
    });
    const { app } = await setup({ sendExecutorThreadMessage });
    const response = await app.request('/api/v1/me/executor/thread/messages', {
      method: 'POST',
      headers: { ...asUser(ids.owner), 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Make Endless the big button',
        client_request_id: 'c1',
        context: { game_id: ids.game, screen: '/g/blobs/play' },
        attachments: [{ upload_id: 'up_1', kind: 'screenshot', mime_type: 'image/jpeg' }],
      }),
    });
    expect(response.status).toBe(202);
    expect(sendExecutorThreadMessage).toHaveBeenCalledWith(
      {
        text: 'Make Endless the big button\n\n[Sent from Open Game Maker: game Blobs (blobs), build bld_42, screen /g/blobs/play]',
        client_request_id: 'ogm:c1',
        attachments: [{ upload_id: 'up_1', kind: 'screenshot', mime_type: 'image/jpeg' }],
      },
      expect.any(AbortSignal),
    );
    expect((await response.json()).message.delivery).toBe('queued');
  });

  it('reports a thread aiur cannot queue to as a conflict, not a crash', async () => {
    const sendExecutorThreadMessage = vi
      .fn()
      .mockRejectedValue(new AiurHttpError(409, 'executor_unavailable', 'read only', 'http://aiur'));
    const { app } = await setup({ sendExecutorThreadMessage });
    const response = await app.request('/api/v1/me/executor/thread/messages', {
      method: 'POST',
      headers: { ...asUser(ids.owner), 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi', client_request_id: 'c2' }),
    });
    expect(response.status).toBe(409);
  });

  it('uploads media to aiur and refuses anything that is not image, audio or video', async () => {
    const uploadExecutorThreadFile = vi
      .fn()
      .mockResolvedValue({ upload_id: 'up_1', kind: 'image', mime_type: 'image/png', byte_size: 3 });
    const { app } = await setup({ uploadExecutorThreadFile });
    const ok = await app.request('/api/v1/me/executor/thread/uploads', {
      method: 'POST',
      headers: { ...asUser(ids.owner), 'content-type': 'image/png', 'x-file-name': 'shot.png' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(ok.status).toBe(201);
    const [blob, name] = uploadExecutorThreadFile.mock.calls[0]!;
    expect(name).toBe('shot.png');
    expect((blob as Blob).size).toBe(3);
    for (const type of ['text/html', 'image/svg+xml']) {
      const refused = await app.request('/api/v1/me/executor/thread/uploads', {
        method: 'POST',
        headers: { ...asUser(ids.owner), 'content-type': type },
        body: new Uint8Array([1]),
      });
      expect(refused.status).toBe(415);
    }
  });

  // The file is served from the app's origin: a page type from the daemon must never render there.
  it('streams a media attachment and refuses a page type', async () => {
    const executorThreadAttachment = vi
      .fn()
      .mockResolvedValueOnce({ mime: 'audio/mpeg', body: new Response(new Uint8Array([7, 8])).body })
      .mockResolvedValueOnce({ mime: 'text/html', body: new Response('<script>').body });
    const { app } = await setup({ executorThreadAttachment });
    const audio = await app.request('/api/v1/me/executor/thread/attachments/att_1', { headers: asUser(ids.owner) });
    expect(audio.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([7, 8]));
    const page = await app.request('/api/v1/me/executor/thread/attachments/att_2', { headers: asUser(ids.owner) });
    expect(page.status).toBe(502);
  });
});
