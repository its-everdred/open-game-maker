import { readFile } from 'node:fs/promises';

import type { AiurClient, Decision, DecisionMedia, DecisionMediaFile } from '@ogm/aiur-client';
import { schema } from '@ogm/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiurMediaTiming, MAX_AIUR_IMAGE_BYTES } from '../../src/commands/aiur-media.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

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
  context: { short_summary: 'Blobs staging' },
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

async function setup(options: Decision['options'], files: Record<string, File>) {
  const deps = seed();
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
      decisions: async () => [decision(options)],
      decisionMedia,
    }) as unknown as AiurClient;
  const { app } = await makeApp(deps);
  const read = async () => {
    const response = await app.request(`/api/v1/games/${ids.game}/commands`, { headers: asUser(ids.user) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      commands: Array<{ options: Array<{ id: string; label: string; media?: Record<string, unknown> }> }>;
    };
    return body.commands[0]!.options;
  };
  return { deps, read, decisionMedia };
}

describe('a jobless Command’s option media', () => {
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
      expect(media?.url).toContain('/blobs/');
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
          ],
        },
        { id: 'hum', label: 'Hum', media: [attachment('med_hum', 'audio', 'audio/mpeg', { duration_ms: 2000 })] },
      ],
      {
        med_pip: { mime: 'image/png', bytes: png },
        med_pip_voice: { mime: 'audio/mpeg', bytes: new Uint8Array([73, 68, 51]) },
        med_hum: { mime: 'audio/mpeg', bytes: new Uint8Array([73, 68, 51]) },
      },
    );

    const [pip, hum] = (await read()) as Array<{ media?: Record<string, unknown>; audio?: Record<string, unknown> }>;

    expect(pip!.media).toMatchObject({ kind: 'image' });
    expect(pip!.audio).toMatchObject({ duration_ms: 2500 });
    expect(String(pip!.audio!.url)).toContain('/blobs/');
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

  it('lists an option whose media aiur cannot serve as text and retries it only after a while', async () => {
    aiurMediaTiming.retryAfterMs = 1_000;
    const files: Record<string, File> = {};
    const { read, deps, decisionMedia } = await setup(
      [
        {
          id: 'flat',
          label: 'Lie flat',
          media: [attachment('med_gone', 'image', 'image/png', { width: 8, height: 8 })],
        },
        { id: 'stack', label: 'Stack up' },
      ],
      files,
    );

    const options = await read();

    expect(options).toEqual([
      { id: 'flat', label: 'Lie flat' },
      { id: 'stack', label: 'Stack up' },
    ]);
    expect(deps.lines.some((line) => line.event === 'game_command_media_copy_failed')).toBe(true);

    // A file that just failed is not fetched again on the next poll.
    files.med_gone = { mime: 'image/png', bytes: new Uint8Array([1]) };
    expect((await read())[0]).toEqual({ id: 'flat', label: 'Lie flat' });
    expect(decisionMedia).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect((await read())[0]!.media).toMatchObject({ kind: 'image', width: 8 });
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
        { id: 'stack', label: 'Stack up' },
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

    expect((await read())[0]).toEqual({ id: 'flat', label: 'Lie flat' });
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
        { id: 'stack', label: 'Stack up' },
      ],
      { med_stuck: { mime: 'video/mp4', body: stalled } },
    );

    expect((await read())[0]).toEqual({ id: 'flat', label: 'Lie flat' });
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
        { id: 'stack', label: 'Stack up' },
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

    expect((await read())[0]).toEqual({ id: 'flat', label: 'Lie flat' });
    expect(deps.lines.some((line) => line.event === 'game_command_media_copy_failed')).toBe(true);
  });

  it('passes an https poster on, drops one only the aiur host holds, and skips media it cannot render', async () => {
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
        { id: 'hop', label: 'Hop', media: [{ kind: 'image', locator: { kind: 'attachment' } }] },
      ],
      {},
    );

    const [roll, spin, hop] = await read();

    expect(roll!.media).toEqual({
      url: 'https://media.example.test/roll.mp4',
      poster: 'https://media.example.test/roll.png',
      width: 64,
      height: 48,
      duration_ms: 1000,
      kind: 'video',
    });
    expect(spin!.media).toEqual({ url: 'https://media.example.test/spin.mp4', width: 640, height: 360, kind: 'video' });
    expect(hop).toEqual({ id: 'hop', label: 'Hop' });
  });
});
