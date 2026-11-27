import { schema } from '@ogm/db';
import { AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { listSince } from '../../src/build-chat/store.js';
import { getChatRuntime } from '../../src/build-chat/routes.js';
import { createApp } from '../../src/app/app.js';
import scopeRoutes, { CREATOR_IMAGES_PER_MINUTE, MAX_CREATOR_IMAGE_BYTES } from '../../src/scope/routes.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

const ids = {
  family: 'f_89000000-0000-4000-8000-000000000001',
  creator: 'u_89000000-0000-4000-8000-000000000001',
  player: 'u_89000000-0000-4000-8000-000000000002',
  otherCreator: 'u_89000000-0000-4000-8000-000000000003',
  game: 'g_89000000-0000-4000-8000-000000000001',
};

const choices = {
  genre: 'platformer',
  vibe: 'cozy',
  family: 'chunky-low-poly',
  world: 'floating islands',
  players: 'single',
  pov: 'isometric',
  other: 'A helpful fox runs the workshop.',
};

function setup() {
  const deps = makeDeps();
  const at = '2026-11-01T18:00:00.000Z';
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.creator, createdAt: at })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values([
      { familyId: ids.family, userId: ids.creator, role: 'owner', capability: 'creator', joinedAt: at },
      { familyId: ids.family, userId: ids.player, role: 'member', capability: 'player', joinedAt: at },
      { familyId: ids.family, userId: ids.otherCreator, role: 'member', capability: 'creator', joinedAt: at },
    ])
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.creator,
      title: 'Fox Workshop',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: at,
    })
    .run();
  deps.db
    .insert(schema.allowances)
    .values({ familyId: ids.family, userId: ids.creator, dailyMicroUsd: 20_000_000 })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.creator,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'creator@example.test',
    },
    {
      kind: 'user',
      userId: ids.player,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'player',
      email: 'player@example.test',
    },
    {
      kind: 'user',
      userId: ids.otherCreator,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'other-creator@example.test',
    },
  ]);
  return deps;
}

function create(app: Awaited<ReturnType<typeof makeApp>>['app'], userId = ids.creator) {
  return app.request(`/api/v1/games/${ids.game}/scope/sessions`, {
    method: 'POST',
    headers: { ...asUser(userId), 'content-type': 'application/json' },
    body: JSON.stringify({ choices }),
  });
}

async function jpegWithExif(): Promise<Buffer> {
  return sharp({
    create: { width: 3, height: 2, channels: 3, background: { r: 10, g: 80, b: 160 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Private creator name' } } })
    .toBuffer();
}

async function bytesOf(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('scope session routes', () => {
  it('keeps an admitted scope session open while its ticket is being filed', async () => {
    const deps = setup();
    const app = createApp(deps);
    app.route('/api/v1/games', scopeRoutes);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    deps.db.update(schema.jobs).set({ state: 'admitted' }).where(eq(schema.jobs.id, created.jobId)).run();
    deps.db
      .insert(schema.jobTickets)
      .values({ jobId: created.jobId, key: 'scope', issueNumber: 42, repo: 'owner/game', sig: 'scope' })
      .run();

    const result = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/abandon`, {
      method: 'POST',
      headers: asUser(ids.creator),
    });
    expect(result.status).toBe(409);
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({ state: 'admitted', releasedAt: null });
    expect(deps.db.select().from(schema.scopeSessions).get()?.status).toBe('open');
  });
  it('admits one small scope job and returns the existing open session on retry', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);

    const first = await create(app);
    expect(first.status).toBe(201);
    const created = (await first.json()) as { sessionId: string; jobId: string };
    const job = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, created.jobId)).get();
    expect(job).toMatchObject({
      kind: 'scope',
      complexity: 1,
      state: 'admitted',
    });
    const plan = JSON.parse(job!.plan) as {
      tickets: { skills: string[]; acceptanceCriteria: string[] }[];
    };
    expect(plan.tickets[0]?.skills).toEqual(['gm-scope-options', 'gm-new-game-design']);
    expect(plan.tickets[0]?.acceptanceCriteria).toEqual(
      expect.arrayContaining([
        expect.stringContaining('at least 15 product decisions across five areas'),
        expect.stringContaining('five to eight open, media-backed product decisions'),
      ]),
    );
    expect(deps.db.select().from(schema.scopeSessions).all()).toHaveLength(1);

    const retry = await create(app);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(created);
    expect(deps.db.select().from(schema.jobs).all()).toHaveLength(1);

    const read = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}`, {
      headers: asUser(ids.creator),
    });
    expect(await read.json()).toMatchObject({ status: 'open', revision: 0, chatJobId: created.jobId, choices });
  });

  it('refuses a player and abandons an open session with its job', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    expect((await create(app, ids.player)).status).toBe(403);

    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    const abandoned = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/abandon`, {
      method: 'POST',
      headers: asUser(ids.creator),
    });
    expect(abandoned.status).toBe(200);
    expect(await abandoned.json()).toMatchObject({ status: 'abandoned', chatJobId: created.jobId });
    expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, created.jobId)).get()?.state).toBe('cancelled');
  });

  it('claims a filed session before cancelling its upstream ticket', async () => {
    const deps = setup();
    const app = createApp(deps);
    app.route('/api/v1/games', scopeRoutes);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    deps.db
      .update(schema.jobs)
      .set({ state: 'filed', aiurRepo: 'owner/game', aiurIssueNumber: 42 })
      .where(eq(schema.jobs.id, created.jobId))
      .run();
    const cancel = vi.fn(async () => {
      expect(deps.db.select().from(schema.scopeSessions).get()?.status).toBe('abandoned');
      expect(deps.db.select().from(schema.jobs).get()?.state).toBe('filed');
      return { process: { status: 'exited' } };
    });
    deps.aiurClientForGame = async () => ({ cancel }) as unknown as AiurClient;

    const abandoned = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/abandon`, {
      method: 'POST',
      headers: asUser(ids.creator),
    });

    expect(abandoned.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith('42');
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
  });

  it('retains the job slot when stopping the abandoned session fails and permits a retry', async () => {
    const deps = setup();
    const app = createApp(deps);
    app.route('/api/v1/games', scopeRoutes);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    deps.db.update(schema.jobs).set({ state: 'filed', aiurRepo: 'owner/game', aiurIssueNumber: 42 }).run();
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue({ process: { status: 'exited' } });
    deps.aiurClientForGame = async () => ({ cancel }) as unknown as AiurClient;
    const abandon = () =>
      app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/abandon`, {
        method: 'POST',
        headers: asUser(ids.creator),
      });

    expect((await abandon()).status).toBe(503);
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({ state: 'filed', releasedAt: null });
    expect((await abandon()).status).toBe(200);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
  });

  it('cancels the tracker ticket when the scope worker is not running', async () => {
    const deps = setup();
    const app = createApp(deps);
    app.route('/api/v1/games', scopeRoutes);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    deps.db.update(schema.jobs).set({ state: 'filed', aiurRepo: 'owner/game', aiurIssueNumber: 42 }).run();
    const cancel = vi.fn().mockRejectedValue(new AiurHttpError(409, 'agent_not_running', 'idle', 'http://127.0.0.1'));
    const setStateLabel = vi.fn().mockResolvedValue(undefined);
    deps.aiurClientForGame = async () => ({ cancel }) as unknown as AiurClient;
    deps.registry.issueStateWriter = { setStateLabel };

    const result = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/abandon`, {
      method: 'POST',
      headers: asUser(ids.creator),
    });
    expect(result.status).toBe(200);
    expect(setStateLabel).toHaveBeenCalledWith('owner/game', 42, 'cancelled', 'agent');
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
  });

  it('starts one revision from the latest agreement and rejects stale or mismatched versions', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    const scope = {
      session_id: created.sessionId,
      revision: 1,
      title: 'Fox Workshop',
      summary: 'Build one cozy workshop.',
      scope: { included: ['workshop'], excluded: ['combat'] },
      tickets: [
        {
          key: 'T1',
          title: 'Build the workshop',
          skills: ['gm-core'],
          dependsOn: [],
          acceptanceCriteria: ['The player completes one order.'],
        },
      ],
      complexity: 2,
      open_questions: [],
      ideas: [],
    };
    deps.db
      .update(schema.scopeSessions)
      .set({ status: 'agreed', revision: 1, scope: JSON.stringify(scope), scopeHash: 'hash-1' })
      .where(eq(schema.scopeSessions.id, created.sessionId))
      .run();

    const revisionUrl = `/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/revisions`;
    const first = await app.request(revisionUrl, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: 'revising', revision: 1, scope });

    const retry = await app.request(revisionUrl, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(retry.status).toBe(200);

    const revisionImage = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 10, g: 80, b: 160 } },
    })
      .png()
      .toBuffer();
    const uploaded = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/images`, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'image/png' },
      body: revisionImage,
    });
    expect(uploaded.status).toBe(201);

    const mismatch = await app.request(revisionUrl, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 2 }),
    });
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toEqual({ error: 'scope_revision_mismatch' });

    const revised = { ...scope, revision: 2, title: 'Smaller Fox Workshop' };
    deps.db
      .update(schema.scopeSessions)
      .set({ status: 'agreed', revision: 2, scope: JSON.stringify(revised), scopeHash: 'hash-2' })
      .where(eq(schema.scopeSessions.id, created.sessionId))
      .run();
    const stale = await app.request(revisionUrl, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'scope_revision_stale' });
  });

  it('stores an oriented WebP without EXIF and returns its chat image id', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    const source = await jpegWithExif();
    const mirror = vi.spyOn(getChatRuntime(deps).mirror, 'mirror');
    expect(await sharp(source).metadata()).toMatchObject({ format: 'jpeg', width: 3, height: 2, orientation: 6 });

    const uploaded = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/images`, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'image/jpeg' },
      body: source,
    });

    expect(uploaded.status).toBe(201);
    const result = (await uploaded.json()) as { imageId: string };
    expect(result).toEqual({ imageId: expect.stringMatching(/^m_/) });
    const rows = listSince(deps.sqlite, created.jobId, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.imageId,
      actor: 'creator',
      kind: 'image',
      width: 2,
      height: 3,
      mirrorState: 'pending',
    });
    expect(mirror).toHaveBeenCalledWith(result.imageId);
    const opened = await deps.blobStore.open(rows[0]!.mediaHash!);
    expect(opened?.ref).toMatchObject({ mime: 'image/webp' });
    const stored = await bytesOf(opened!.stream);
    const metadata = await sharp(stored).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 2, height: 3 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });

  it('rejects non-images and invalid image bytes without storing them', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    const put = vi.spyOn(deps.blobStore, 'put');
    const url = `/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/images`;

    const wrongType = await app.request(url, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'text/plain' },
      body: 'not an image',
    });
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toEqual({ error: 'unsupported_image_type' });

    const invalid = await app.request(url, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'image/jpeg' },
      body: 'not a jpeg',
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ error: 'invalid_image' });
    expect(put).not.toHaveBeenCalled();
    expect(listSince(deps.sqlite, created.jobId, 0)).toEqual([]);
  });

  it('rejects declared and streamed uploads above 10 MiB without storing them', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    const put = vi.spyOn(deps.blobStore, 'put');
    const url = `/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/images`;

    const declared = await app.request(url, {
      method: 'POST',
      headers: {
        ...asUser(ids.creator),
        'content-type': 'image/png',
        'content-length': String(MAX_CREATOR_IMAGE_BYTES + 1),
      },
      body: new Uint8Array(),
    });
    expect(declared.status).toBe(413);

    const chunk = new Uint8Array(1024 * 1024);
    let remaining = 11;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining === 0) {
          controller.close();
          return;
        }
        remaining -= 1;
        controller.enqueue(chunk);
      },
    });
    const streamed = await app.request(url, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'image/png' },
      body,
      duplex: 'half',
    } as RequestInit);
    await body.cancel().catch(() => undefined);
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toEqual({ error: 'image_too_large' });
    expect(put).not.toHaveBeenCalled();
    expect(listSince(deps.sqlite, created.jobId, 0)).toEqual([]);
  });

  it('rejects another creator without storing the image', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    const put = vi.spyOn(deps.blobStore, 'put');

    const response = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/images`, {
      method: 'POST',
      headers: { ...asUser(ids.otherCreator), 'content-type': 'image/png' },
      body: await jpegWithExif(),
    });

    expect(response.status).toBe(403);
    expect(put).not.toHaveBeenCalled();
    expect(listSince(deps.sqlite, created.jobId, 0)).toEqual([]);
  });

  it('rejects uploads after the scope session closes', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/abandon`, {
      method: 'POST',
      headers: asUser(ids.creator),
    });
    const put = vi.spyOn(deps.blobStore, 'put');

    const response = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/images`, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'image/jpeg' },
      body: await jpegWithExif(),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'scope_session_not_open' });
    expect(put).not.toHaveBeenCalled();
    expect(listSince(deps.sqlite, created.jobId, 0)).toEqual([]);
  });

  it('does not append an upload when the session closes during image processing', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    const originalPut = deps.blobStore.put.bind(deps.blobStore);
    let processingStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      processingStarted = resolve;
    });
    let finishProcessing!: () => void;
    const finish = new Promise<void>((resolve) => {
      finishProcessing = resolve;
    });
    vi.spyOn(deps.blobStore, 'put').mockImplementation(async (bytes, mime) => {
      processingStarted();
      await finish;
      return originalPut(bytes, mime);
    });

    const uploading = app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/images`, {
      method: 'POST',
      headers: { ...asUser(ids.creator), 'content-type': 'image/jpeg' },
      body: await jpegWithExif(),
    });
    await started;
    const abandoned = await app.request(`/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/abandon`, {
      method: 'POST',
      headers: asUser(ids.creator),
    });
    finishProcessing();
    const response = await uploading;

    expect(abandoned.status).toBe(200);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'scope_session_not_open' });
    expect(listSince(deps.sqlite, created.jobId, 0)).toEqual([]);
  });

  it('rate-limits repeated uploads before storing another image', async () => {
    const deps = setup();
    const { app } = await makeApp(deps);
    const created = (await (await create(app)).json()) as { sessionId: string; jobId: string };
    const image = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const url = `/api/v1/games/${ids.game}/scope/sessions/${created.sessionId}/images`;
    const upload = () =>
      app.request(url, {
        method: 'POST',
        headers: { ...asUser(ids.creator), 'content-type': 'image/png' },
        body: image,
      });

    for (let count = 0; count < CREATOR_IMAGES_PER_MINUTE; count += 1) {
      expect((await upload()).status).toBe(201);
    }
    const put = vi.spyOn(deps.blobStore, 'put');
    const limited = await upload();

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(put).not.toHaveBeenCalled();
    expect(listSince(deps.sqlite, created.jobId, 0)).toHaveLength(CREATOR_IMAGES_PER_MINUTE);
  });
});
