import { readFile } from 'node:fs/promises';

import type { AiurClient, Decision, DecisionMedia, DecisionMediaFile } from '@ogm/aiur-client';
import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

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

async function setup(options: Decision['options'], files: Record<string, { mime: string; bytes: Uint8Array }>) {
  const deps = seed();
  const decisionMedia = vi.fn(async (_id: string, attachmentId: string): Promise<DecisionMediaFile> => {
    const file = files[attachmentId];
    if (file === undefined) throw new Error('not found');
    return { mime: file.mime, body: new Response(file.bytes).body! };
  });
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

  it('lists an option whose media aiur cannot serve as text and retries it next time', async () => {
    const files: Record<string, { mime: string; bytes: Uint8Array }> = {};
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
    expect(deps.lines.some((line) => line.event === 'game_command_media_unavailable')).toBe(true);

    files.med_gone = { mime: 'image/png', bytes: new Uint8Array([1]) };
    expect((await read())[0]!.media).toMatchObject({ kind: 'image', width: 8 });
    expect(decisionMedia).toHaveBeenCalledTimes(2);
  });
});
