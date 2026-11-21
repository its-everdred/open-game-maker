import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { link, mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AiurClient, Decision, DecisionMedia, DecisionMediaFile } from '@ogm/aiur-client';
import { CREATOR_AUDIENCE_MARKER, reviewMetaMarker } from '@ogm/contracts';
import { eq } from 'drizzle-orm';
import { schema } from '@ogm/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiurMediaTiming, MAX_AIUR_IMAGE_BYTES } from '../../src/commands/aiur-media.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';
import { insertChatRow } from '../../src/build-chat/store.js';

// A registered game's Commands have no job, so their option media lives on the aiur host (#611). The Blobs staging
// Command carried a picture per option and the deck showed text only. The inbox must turn each option's aiur media into
// a URL the browser can load without an aiur credential: copied into the blob store and signed like a job's media.

const ids = {
  family: 'f_61100000-0000-4000-8000-000000000001',
  user: 'u_61100000-0000-4000-8000-000000000001',
  game: 'g_61100000-0000-4000-8000-000000000001',
};
const AT = '2026-11-07T10:00:00.000Z';
const PNG = new URL('../build-chat/fixtures/tiny.png', import.meta.url);

function seed() {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.user, createdAt: AT })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: ids.family, userId: ids.user, role: 'owner', capability: 'creator', joinedAt: AT })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.user,
      title: 'Blobs',
      slug: 'blobs',
      githubOwner: 'fixture',
      githubRepo: 'blobs',
      githubPath: 'games/blobs',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: AT,
    })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.user,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'creator@example.test',
    },
  ]);
  deps.registry.trackerTickets = async () => ({
    stale: false,
    tickets: [
      {
        ticket: '12',
        title: 'Ticket',
        labels: ['game:blobs'],
        closedAt: null,
        updatedAt: AT,
        outcome: 'Closed',
        url: 'https://example.test/issue',
      },
    ],
  });
  return deps;
}

const attachment = (id: string, kind: string, mime: string, extra: Partial<DecisionMedia> = {}): DecisionMedia => ({
  kind,
  mime_type: mime,
  attachment_id: id,
  width: null,
  height: null,
  duration_ms: null,
  locator: { kind: 'attachment', attachment_id: id },
  poster: null,
  ...extra,
});

const decision = (options: Decision['options']): Decision => ({
  decision_id: 'dec_blobs',
  version: 1,
  ticket: { identifier: '12' },
  kind: 'command',
  authority: 'supervisor_allowed',
  blocking: true,
  reversibility: 'reversible',
  question: 'How should the blobs rest?',
  options,
  recommendation: null,
  context: { short_summary: 'Blobs staging', long_context_markdown: CREATOR_AUDIENCE_MARKER },
  answer: null,
  active_answer: null,
  created_at: AT,
  decision_status: 'open',
});

type File = { mime: string; bytes?: Uint8Array; body?: (signal?: AbortSignal) => ReadableStream<Uint8Array> };

// A body that sends nothing until the request's signal aborts it, like a transfer that stalls.
const stalled = (signal?: AbortSignal) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal.reason));
    },
  });

const defaults = { ...aiurMediaTiming };
afterEach(() => Object.assign(aiurMediaTiming, defaults));

async function setup(options: Decision['options'], files: Record<string, File>, creatorMarker = true, root?: string) {
  const deps = seed();
  if (root) deps.config.builderWorkspacesRoot = root;
  const decisionMedia = vi.fn(
    async (_id: string, attachmentId: string, signal?: AbortSignal): Promise<DecisionMediaFile> => {
      const file = files[attachmentId];
      if (file === undefined) throw new Error('not found');
      return { mime: file.mime, body: file.body ? file.body(signal) : new Response(file.bytes).body! };
    },
  );
  deps.aiurClientForGame = async () =>
    ({
      baseUrl: 'http://127.0.0.1:4100',
      decisions: async () => [{ ...decision(options), ...(creatorMarker ? {} : { context: {} }) }],
      decisionMedia,
    }) as unknown as AiurClient;
  const { app } = await makeApp(deps);
  const read = async () => {
    const response = await app.request(`/api/v1/games/${ids.game}/commands`, { headers: asUser(ids.user) });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      commands: Array<{
        options: Array<{ id: string; label: string; media?: Record<string, unknown>; meta?: Record<string, unknown> }>;
      }>;
    };
    return body.commands[0]?.options ?? [];
  };
  return { deps, read, decisionMedia };
}

describe('a jobless Command’s option media', () => {
  it('refuses a Command when any option media is outside the owning ticket review directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ogm-media-'));
    try {
      const review = join(root, 'fixture', 'blobs', '12', 'review', '12');
      await mkdir(review, { recursive: true });
      const video = join(review, 'clip.mp4');
      await writeFile(video, 'video bytes');
      await writeFile(`${video}.meta.json`, JSON.stringify({ kind: '3D model render', model: 'fixture-renderer' }));
      const secret = join(root, 'secret.mp4');
      await writeFile(secret, 'secret');
      const link = join(review, 'escape.mp4');
      await symlink(secret, link);
      const pathMedia = (value: string) => ({
        kind: 'video',
        mime_type: 'video/mp4',
        locator: { kind: 'path', value },
      });
      const { read, deps } = await setup(
        [
          { id: 'a', label: 'Video', media: [pathMedia(video)] },
          { id: 'b', label: 'Escape', media: [pathMedia(link)] },
        ],
        {},
        true,
        root,
      );
      expect(await read()).toEqual([]);
      expect(deps.lines.some((line) => line.event === 'game_command_media_copy_failed')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('reads fleet workspace media again after the decision version changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ogm-fleet-media-'));
    try {
      const checkout = join(root, 'daemon');
      const review = join(checkout, 'workspaces', 'fixture', 'blobs', '12', 'games', 'blobs', 'review', '12');
      await mkdir(review, { recursive: true });
      const video = join(review, 'clip.mp4');
      await writeFile(video, 'first video');
      const options = [
        {
          id: 'a',
          label: 'Video',
          media: [{ kind: 'video', mime_type: 'video/mp4', locator: { kind: 'path', value: video } }],
        },
        {
          id: 'b',
          label: 'Other',
          media: [{ kind: 'image', locator: { kind: 'url', value: 'https://example.test/b.png' } }],
        },
      ];
      const { deps, read } = await setup(options, {}, true, root);
      deps.db
        .update(schema.games)
        .set({ githubOwner: 'Fixture', githubRepo: 'Blobs' })
        .where(eq(schema.games.id, ids.game))
        .run();
      deps.db
        .insert(schema.gameDaemons)
        .values({
          slug: 'blobs',
          repo: 'fixture/blobs',
          checkoutPath: checkout,
          unit: 'fixture',
          envFile: '/fixture',
          port: 23456,
          status: 'running',
          createdAt: AT,
        })
        .run();
      let version = 1;
      deps.aiurClientForGame = async () =>
        ({
          baseUrl: 'http://127.0.0.1:4100',
          decisions: async () => [{ ...decision(options), version }],
        }) as unknown as AiurClient;
      const first = (await read())[0]!.media!.url;
      await writeFile(video, 'second video');
      version = 2;
      const second = (await read())[0]!.media!.url;
      expect(new URL(second as string).pathname).not.toBe(new URL(first as string).pathname);
      const secret = join(root, 'secret.mp4');
      const linked = join(review, 'linked.mp4');
      await writeFile(secret, 'private');
      await link(secret, linked);
      const { pathMedia } = await import('../../src/commands/path-media.js');
      const namespaced = await pathMedia(
        deps,
        {
          owner: 'fixture',
          name: 'blobs',
          ticket: '12',
          workspaceRoot: join(checkout, 'workspaces', 'fixture', 'blobs'),
          gamePath: 'games/blobs',
        },
        video,
        'video/mp4',
        100,
      );
      expect(await new Response(namespaced.body).text()).toBe('second video');
      await expect(
        pathMedia(
          deps,
          {
            owner: 'fixture',
            name: 'blobs',
            ticket: '12',
            workspaceRoot: join(checkout, 'workspaces'),
            gamePath: 'games/blobs',
          },
          linked,
          'video/mp4',
          100,
        ),
      ).rejects.toThrow('invalid media file');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects a named pipe without waiting for a writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ogm-pipe-media-'));
    try {
      const review = join(root, 'fixture', 'blobs', '12', 'review', '12');
      await mkdir(review, { recursive: true });
      const pipe = join(review, 'pipe.mp4');
      execFileSync('mkfifo', [pipe]);
      const deps = seed();
      deps.config.builderWorkspacesRoot = root;
      const { pathMedia } = await import('../../src/commands/path-media.js');
      const pending = pathMedia(deps, { owner: 'fixture', name: 'blobs', ticket: '12' }, pipe, 'video/mp4', 100).then(
        () => 'accepted',
        () => 'rejected',
      );
      const result = await Promise.race([
        pending,
        new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 2000)),
      ]);
      if (result === 'blocked') {
        const writer = await open(pipe, constants.O_WRONLY | constants.O_NONBLOCK);
        await pending;
        await writer.close();
      }
      expect(result).toBe('rejected');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('routes core Command attachments through the app origin', async () => {
    const png = new Uint8Array(await readFile(PNG));
    const options = [
      { id: 'a', label: 'Portrait', media: [attachment('core-image', 'image', 'image/png')] },
      {
        id: 'b',
        label: 'Alternative',
        media: [{ kind: 'image', locator: { kind: 'url', value: 'https://example.test/b.png' } }],
      },
    ];
    const deps = seed();
    deps.config.instanceOwnerId = ids.user;
    deps.registry.coreAiurClient = {
      baseUrl: 'https://core.example.test',
      decisions: async () => [decision(options)],
      decisionMedia: async () => ({ mime: 'image/png', body: new Response(png).body! }),
    } as unknown as AiurClient;
    const { app } = await makeApp(deps);
    const response = await app.request('/api/v1/me/core-commands', { headers: asUser(ids.user) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { commands: { options: { media: { url: string }; meta?: unknown }[] }[] };
    const url = new URL(body.commands[0]!.options[0]!.media.url);
    expect(url.origin).toBe(deps.config.appOrigin);
    expect(url.pathname).toMatch(/^\/api\/v1\/blobs\/sha256\//);
    const image = await app.request(`${url.pathname}${url.search}`);
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
  });
  it('lists marker metadata on the core creator command endpoint', async () => {
    const deps = seed();
    deps.config.instanceOwnerId = ids.user;
    const marker = reviewMetaMarker(
      new Map([
        [
          'a',
          { meta: { kind: 'image generation', model: 'gpt-image-1' }, layout: { row: 'hero', stage: 'candidate' } },
        ],
      ]),
    );
    deps.registry.coreAiurClient = {
      baseUrl: 'https://core.example.test',
      decisions: async () => [
        {
          ...decision([
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ]),
          context: {
            short_summary: 'Review',
            long_context_markdown: `<!-- gm-command:cp_01JBX2Q7M3K8V5N4R6T9W0YZAB -->\n${CREATOR_AUDIENCE_MARKER}\n${marker}`,
          },
        },
      ],
    } as unknown as AiurClient;
    const { app } = await makeApp(deps);
    const response = await app.request('/api/v1/me/core-commands', { headers: asUser(ids.user) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      commands: Array<{ options: Array<{ meta?: unknown; layout?: unknown }> }>;
    };
    expect(body.commands[0]!.options[0]).toMatchObject({
      meta: { kind: 'image generation' },
      layout: { row: 'hero', stage: 'candidate' },
    });
  });
  it('retains all Aiur sounds for a matching job-linked Command but not for a different version', async () => {
    const options = [
      {
        id: 'pip',
        label: 'Pip',
        media: [attachment('voice-1', 'audio', 'audio/mpeg'), attachment('voice-2', 'audio', 'audio/mpeg')],
      },
      { id: 'hum', label: 'Hum', media: [attachment('voice-3', 'audio', 'audio/mpeg')] },
    ];
    const files = Object.fromEntries(
      ['voice-1', 'voice-2', 'voice-3'].map((id, index) => [
        id,
        { mime: 'audio/mpeg', bytes: new Uint8Array([73, 68, 51 + index]) },
      ]),
    );
    const { deps, read } = await setup(options, files, false);
    const jobId = 'j_61100000-0000-4000-8000-000000000001';
    deps.db
      .insert(schema.jobs)
      .values({
        id: jobId,
        gameId: ids.game,
        branchId: 'main',
        familyId: ids.family,
        creatorId: ids.user,
        kind: 'feature',
        complexity: 2,
        state: 'running',
        start: 'now',
        slot: 'edit',
        plan: JSON.stringify({
          title: 'Job',
          summary: 'Review',
          scope: { included: [], excluded: [] },
          tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: [] }],
        }),
        reservation: JSON.stringify({ amountMicroUsd: 1, sizeClass: 'small', confidence: 'high' }),
        hardCapMicroUsd: 1,
        aiurIssueNumber: 12,
        aiurRepo: 'fixture/blobs',
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    insertChatRow(deps.sqlite, {
      id: '01JBX2Q7M3K8V5N4R6T9W0YZAC',
      jobId,
      actor: 'agent',
      kind: 'image',
      media: { hash: `sha256:${'a'.repeat(64)}`, width: 320, height: 200 },
    });
    const addCommand = (id: string, version: number) =>
      insertChatRow(deps.sqlite, {
        id,
        jobId,
        at: AT,
        actor: 'agent',
        kind: 'command',
        command: {
          command_id: 'local',
          decision_id: 'dec_blobs',
          version,
          question: 'Which?',
          options: [
            { id: 'pip', label: 'Pip', media_id: '01JBX2Q7M3K8V5N4R6T9W0YZAC' },
            { id: 'hum', label: 'Hum', playable: { scenario: 'sound=hum', seconds: 8 } },
          ],
          blocking: true,
          status: 'open',
        },
      });
    addCommand('01JBX2Q7M3K8V5N4R6T9W0YZAB', 1);
    const [pip] = (await read()) as Array<{ media?: unknown; audio?: unknown; audioClips?: unknown[] }>;
    expect(pip!.media).toMatchObject({ width: 320 });
    expect(pip!.audio).toBeDefined();
    expect(pip!.audioClips).toHaveLength(1);
    deps.sqlite
      .prepare("UPDATE build_chat_messages SET command_json = json_set(command_json, '$.version', 2) WHERE id = ?")
      .run('01JBX2Q7M3K8V5N4R6T9W0YZAB');
    const [newer] = (await read()) as Array<{ media?: unknown; audio?: unknown; audioClips?: unknown[] }>;
    expect(newer!.media).toMatchObject({ width: 320 });
    expect(newer!.audio).toBeUndefined();
    expect(newer!.audioClips).toBeUndefined();
  });
  it('signs image, clip and sample media so the deck can show each option', async () => {
    const png = new Uint8Array(await readFile(PNG));
    const { read, deps } = await setup(
      [
        { id: 'flat', label: 'Lie flat on a table', media: [attachment('med_flat', 'image', 'image/png')] },
        {
          id: 'roll',
          label: 'Roll across the floor',
          media: [attachment('med_roll', 'video', 'video/mp4', { width: 1280, height: 720, duration_ms: 3000 })],
        },
        {
          id: 'hum',
          label: 'Hum while resting',
          media: [attachment('med_hum', 'audio', 'audio/mpeg', { duration_ms: 2000 })],
        },
      ],
      {
        med_flat: { mime: 'image/png', bytes: png },
        med_roll: { mime: 'video/mp4', bytes: new Uint8Array([0, 0, 0, 24]) },
        med_hum: { mime: 'audio/mpeg', bytes: new Uint8Array([73, 68, 51]) },
      },
    );

    const options = await read();

    const [flat, roll, hum] = options.map((option) => option.media);
    // Every URL is a signed blob URL, never the aiur host and never carrying its token.
    for (const media of [flat, roll, hum]) {
      expect(media?.url).toContain('https://app.example.test/api/v1/blobs/sha256/');
      expect(String(media?.url)).not.toContain('127.0.0.1:4100');
    }
    // A still aiur sent without a size is measured, so its card keeps the picture's shape.
    const meta = await (await import('sharp')).default(png).metadata();
    expect(flat).toMatchObject({ kind: 'image', width: meta.width, height: meta.height });
    expect(flat).not.toHaveProperty('duration_ms');
    // A clip with no servable poster still names itself a clip, or the deck would play it as a sample.
    expect(roll).toMatchObject({ kind: 'video', width: 1280, height: 720, duration_ms: 3000 });
    expect(hum).toMatchObject({ kind: 'audio', duration_ms: 2000 });
    // The blob behind the signed URL is the aiur file's bytes.
    const hash = `sha256:${String(flat!.url).split('/blobs/sha256/')[1]!.split('?')[0]}` as const;
    expect((await deps.blobStore.head(hash))?.mime).toBe('image/png');
  });

  // #631: a character card carries its portrait and its voice. Keeping only the first item showed the portrait and
  // dropped the voice, so the creator heard nothing on the Blobs voices deck.
  it('keeps a character card’s voice beside its portrait', async () => {
    const png = new Uint8Array(await readFile(PNG));
    const { read } = await setup(
      [
        {
          id: 'pip',
          label: 'Pip',
          // aiur lists the voice first here: the card still shows the portrait.
          media: [
            attachment('med_pip_voice', 'audio', 'audio/mpeg', { duration_ms: 2500 }),
            attachment('med_pip', 'image', 'image/png'),
            attachment('med_pip_voice_2', 'audio', 'audio/mpeg', { duration_ms: 1200 }),
          ],
        },
        { id: 'hum', label: 'Hum', media: [attachment('med_hum', 'audio', 'audio/mpeg', { duration_ms: 2000 })] },
      ],
      {
        med_pip: { mime: 'image/png', bytes: png },
        med_pip_voice: { mime: 'audio/mpeg', bytes: new Uint8Array([73, 68, 51]) },
        med_pip_voice_2: { mime: 'audio/mpeg', bytes: new Uint8Array([73, 68, 52]) },
        med_hum: { mime: 'audio/mpeg', bytes: new Uint8Array([73, 68, 51]) },
      },
    );

    const [pip, hum] = (await read()) as Array<{
      media?: Record<string, unknown>;
      audio?: Record<string, unknown>;
      audioClips?: Record<string, unknown>[];
    }>;

    expect(pip!.media).toMatchObject({ kind: 'image' });
    expect(pip!.audio).toMatchObject({ duration_ms: 2500 });
    expect(String(pip!.audio!.url)).toContain('/blobs/');
    expect(pip!.audioClips).toMatchObject([{ duration_ms: 1200 }]);
    // A card whose only item is a sound already plays it as its media; it gets no second copy.
    expect(hum!.media).toMatchObject({ kind: 'audio' });
    expect(hum!).not.toHaveProperty('audio');
  });

  it('passes a vetted https file through and copies each attachment only once', async () => {
    const { read, decisionMedia } = await setup(
      [
        {
          id: 'flat',
          label: 'Lie flat',
          media: [
            {
              kind: 'image',
              mime_type: 'image/png',
              width: 10,
              height: 20,
              locator: { kind: 'url', value: 'https://media.example.test/flat.png' },
            },
          ],
        },
        {
          id: 'stack',
          label: 'Stack up',
          media: [attachment('med_stack', 'image', 'image/png', { width: 30, height: 40 })],
        },
      ],
      { med_stack: { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) } },
    );

    const first = await read();
    await read();

    expect(first[0]!.media).toMatchObject({ url: 'https://media.example.test/flat.png', width: 10, height: 20 });
    expect(first[1]!.media).toMatchObject({ kind: 'image', width: 30, height: 40 });
    expect(decisionMedia).toHaveBeenCalledTimes(1);
  });

  it('omits a Command with unavailable option media, then lists it once the media resolves', async () => {
    aiurMediaTiming.retryAfterMs = 1_000;
    const files: Record<string, File> = {};
    const { read, deps, decisionMedia } = await setup(
      [
        {
          id: 'flat',
          label: 'Lie flat',
          media: [attachment('med_gone', 'image', 'image/png', { width: 8, height: 8 })],
        },
        {
          id: 'stack',
          label: 'Stack up',
          media: [{ kind: 'image', locator: { kind: 'url', value: 'https://example.test/stack.png' } }],
        },
      ],
      files,
    );

    const options = await read();

    expect(options).toEqual([]);
    expect(deps.lines.some((line) => line.event === 'game_command_media_copy_failed')).toBe(true);

    // A file that just failed is not fetched again on the next poll.
    files.med_gone = { mime: 'image/png', bytes: new Uint8Array([1]) };
    expect(await read()).toEqual([]);
    expect(decisionMedia).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect((await read()).map((option) => option.media)).toEqual([
      expect.objectContaining({ kind: 'image', width: 8 }),
      expect.objectContaining({ kind: 'image', url: 'https://example.test/stack.png' }),
    ]);
    expect(decisionMedia).toHaveBeenCalledTimes(2);
  });

  // One slow file must not hold every Command back: the inbox answers without it and the copy finishes for later.
  it('answers without a slow copy and shows it once the copy lands', async () => {
    aiurMediaTiming.inboxWaitMs = 20;
    let finish: () => void = () => undefined;
    const { read, decisionMedia } = await setup(
      [
        {
          id: 'flat',
          label: 'Lie flat',
          media: [attachment('med_slow', 'image', 'image/png', { width: 8, height: 8 })],
        },
        {
          id: 'stack',
          label: 'Stack up',
          media: [{ kind: 'image', locator: { kind: 'url', value: 'https://example.test/stack.png' } }],
        },
      ],
      {
        med_slow: {
          mime: 'image/png',
          body: () =>
            new ReadableStream({
              start(controller) {
                finish = () => {
                  controller.enqueue(new Uint8Array([1]));
                  controller.close();
                };
              },
            }),
        },
      },
    );

    expect(await read()).toEqual([]);
    finish();
    await vi.waitFor(async () => expect((await read())[0]!.media).toMatchObject({ kind: 'image' }));
    expect(decisionMedia).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled transfer and logs it', async () => {
    Object.assign(aiurMediaTiming, { inboxWaitMs: 20, copyTimeoutMs: 100 });
    const { read, deps, decisionMedia } = await setup(
      [
        {
          id: 'flat',
          label: 'Lie flat',
          media: [attachment('med_stuck', 'video', 'video/mp4', { width: 8, height: 8 })],
        },
        {
          id: 'stack',
          label: 'Stack up',
          media: [{ kind: 'image', locator: { kind: 'url', value: 'https://example.test/stack.png' } }],
        },
      ],
      { med_stuck: { mime: 'video/mp4', body: stalled } },
    );

    expect(await read()).toEqual([]);
    await vi.waitFor(() => expect(decisionMedia.mock.calls[0]![2]?.aborted).toBe(true));
    await vi.waitFor(() =>
      expect(deps.lines.some((line) => line.event === 'game_command_media_copy_failed')).toBe(true),
    );
  });

  // A still without a size is held in memory to be measured, so it may not be larger than aiur's largest still.
  it('refuses a still to be measured that is larger than aiur allows', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const { read, deps } = await setup(
      [
        { id: 'flat', label: 'Lie flat', media: [attachment('med_huge', 'image', 'image/png')] },
        {
          id: 'stack',
          label: 'Stack up',
          media: [{ kind: 'image', locator: { kind: 'url', value: 'https://example.test/stack.png' } }],
        },
      ],
      {
        med_huge: {
          mime: 'image/png',
          body: () => {
            let sent = 0;
            return new ReadableStream({
              pull(controller) {
                if (sent > MAX_AIUR_IMAGE_BYTES) return controller.close();
                sent += chunk.byteLength;
                controller.enqueue(chunk);
              },
            });
          },
        },
      },
    );

    expect(await read()).toEqual([]);
    expect(deps.lines.some((line) => line.event === 'game_command_media_copy_failed')).toBe(true);
  });

  it('passes an https poster on and drops one only the aiur host holds', async () => {
    const { read } = await setup(
      [
        {
          id: 'roll',
          label: 'Roll',
          media: [
            { kind: 'document', locator: { kind: 'url', value: 'https://media.example.test/notes.pdf' } },
            {
              kind: 'video',
              width: 64,
              height: 48,
              duration_ms: 1000,
              locator: { kind: 'url', value: 'https://media.example.test/roll.mp4' },
              poster: { kind: 'url', value: 'https://media.example.test/roll.png' },
            },
          ],
        },
        {
          id: 'spin',
          label: 'Spin',
          media: [
            {
              kind: 'video',
              locator: { kind: 'url', value: 'https://media.example.test/spin.mp4' },
              poster: { kind: 'attachment', attachment_id: 'med_poster' },
            },
          ],
        },
      ],
      {},
    );

    const [roll, spin] = await read();

    expect(roll!.media).toEqual({
      url: 'https://media.example.test/roll.mp4',
      poster: 'https://media.example.test/roll.png',
      width: 64,
      height: 48,
      duration_ms: 1000,
      kind: 'video',
    });
    expect(spin!.media).toEqual({ url: 'https://media.example.test/spin.mp4', width: 640, height: 360, kind: 'video' });
  });

  it('omits a review when one option has no renderable media', async () => {
    const { read } = await setup(
      [
        {
          id: 'roll',
          label: 'Roll',
          media: [{ kind: 'video', locator: { kind: 'url', value: 'https://example.test/roll.mp4' } }],
        },
        { id: 'hop', label: 'Hop', media: [{ kind: 'image', locator: { kind: 'attachment' } }] },
      ],
      {},
    );

    expect(await read()).toEqual([]);
  });
});
