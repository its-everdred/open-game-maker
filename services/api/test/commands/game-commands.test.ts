import { AiurHttpError, type AiurClient, type Decision } from '@ogm/aiur-client';
import { CREATOR_AUDIENCE_MARKER } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { HttpError } from '../../src/app/errors.js';
import { insertChatRow } from '../../src/build-chat/store.js';
import { listReviews } from '../../src/reviews/store.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

const ids = {
  family: 'f_60000000-0000-4000-8000-000000000001',
  user: 'u_60000000-0000-4000-8000-000000000001',
  outsider: 'u_60000000-0000-4000-8000-000000000002',
  otherFamily: 'f_60000000-0000-4000-8000-000000000003',
  game: 'g_60000000-0000-4000-8000-000000000001',
  otherGame: 'g_60000000-0000-4000-8000-000000000002',
  job: 'j_60000000-0000-4000-8000-000000000001',
  otherJob: 'j_60000000-0000-4000-8000-000000000002',
  linkedJob: 'j_60000000-0000-4000-8000-000000000003',
};

const AT = '2026-11-04T10:00:00.000Z';
const ULID = '01JBX2Q7M3K8V5N4R6T9W0YZAB';
const MEDIA_ID = '01JBX2Q7M3K8V5N4R6T9W0YZAC';

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
  for (const id of [ids.game, ids.otherGame]) {
    deps.db
      .insert(schema.games)
      .values({
        id,
        familyId: ids.family,
        ownerId: ids.user,
        title: `Game ${id.slice(-1)}`,
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: AT,
      })
      .run();
  }
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.user,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'creator@example.test',
    },
    {
      kind: 'user',
      userId: ids.outsider,
      familyId: ids.otherFamily,
      platformRole: 'none',
      capability: 'creator',
      email: 'outsider@example.test',
    },
  ]);
  return deps;
}

function job(deps: ReturnType<typeof makeDeps>, id: string, gameId: string, createdAt: string) {
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId,
      branchId: 'main',
      familyId: ids.family,
      creatorId: ids.user,
      kind: 'feature',
      complexity: 2,
      state: 'running',
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify({
        title: `Job ${id.slice(-1)}`,
        summary: 'Add the moon gate',
        scope: { included: ['moon gate'], excluded: [] },
        targetControls: [],
        tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['loads'] }],
      }),
      reservation: JSON.stringify({ amountMicroUsd: 500_000, sizeClass: 'small', confidence: 'high' }),
      hardCapMicroUsd: 500_000,
      usageMicroUsd: 0,
      idempotencyKey: `key-${id}`,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
}

function checkpoint(
  deps: ReturnType<typeof makeDeps>,
  jobId: string,
  id: string,
  overrides: {
    decision_id?: string;
    status?: 'open' | 'answered' | 'moot';
    version?: number | undefined;
    at?: string;
    options?: Array<{ id: string; label: string; media_id?: string }>;
    topic?: string;
  } = {},
) {
  insertChatRow(deps.sqlite, {
    id,
    jobId,
    at: overrides.at ?? AT,
    actor: 'agent',
    kind: 'checkpoint',
    checkpoint: {
      decision_id: overrides.decision_id ?? `d_${id.slice(-6)}`,
      question: 'Which door?',
      options: overrides.options ?? [
        { id: 'wood', label: 'Wooden door' },
        { id: 'iron', label: 'Iron door' },
      ],
      recommend: 'wood',
      blocking: true,
      status: overrides.status ?? 'open',
      ...(overrides.topic === undefined ? {} : { topic: overrides.topic }),
      ...(overrides.version === undefined ? { version: 3 } : { version: overrides.version }),
    },
  });
}

async function appWithJobs() {
  const deps = seed();
  job(deps, ids.job, ids.game, '2026-11-04T09:00:00.000Z');
  job(deps, ids.linkedJob, ids.game, '2026-11-04T11:00:00.000Z');
  job(deps, ids.otherJob, ids.otherGame, '2026-11-04T09:30:00.000Z');
  const { app } = await makeApp(deps);
  return { app, deps };
}

const get = async (app: Awaited<ReturnType<typeof makeApp>>['app'], gameId: string, userId = ids.user) => {
  const response = await app.request(`/api/v1/games/${gameId}/commands`, { headers: asUser(userId) });
  if (!response.ok) console.error('FAILBODY', response.status, await response.clone().text());
  return response;
};

describe('game commands inbox', () => {
  it('lists the open Commands of every job in the game, newest first', async () => {
    const { app, deps } = await appWithJobs();
    checkpoint(deps, ids.job, ULID);
    checkpoint(deps, ids.linkedJob, MEDIA_ID, { at: '2026-11-04T12:00:00.000Z' });
    checkpoint(deps, ids.otherJob, '01JBX2Q7M3K8V5N4R6T9W0YZAD');

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<{
        job_id: string;
        title: string;
        checkpoint_id: string;
        question: string;
        version: number;
        options: unknown;
      }>;
    };

    expect(body.commands.map(({ job_id }) => job_id)).toEqual([ids.linkedJob, ids.job]);
    expect(body.commands[0]).toMatchObject({
      title: 'Job 3',
      checkpoint_id: MEDIA_ID,
      question: 'Which door?',
      version: 3,
    });
    expect(body.commands[0]!.options).toEqual([
      { id: 'wood', label: 'Wooden door' },
      { id: 'iron', label: 'Iron door' },
    ]);
  });

  it('titles a Command with its own topic, and an older one without a topic with its job', async () => {
    const { app, deps } = await appWithJobs();
    checkpoint(deps, ids.job, ULID, { topic: 'Front door material' });
    checkpoint(deps, ids.linkedJob, MEDIA_ID);

    const body = (await (await get(app, ids.game)).json()) as { commands: Array<{ job_id: string; title: string }> };

    expect(body.commands).toContainEqual(expect.objectContaining({ job_id: ids.job, title: 'Front door material' }));
    expect(body.commands).toContainEqual(expect.objectContaining({ job_id: ids.linkedJob, title: 'Job 3' }));
  });

  // The short link `/<slug>/review/<n>` (#591) must keep opening the same Command: a number is given once, in the
  // order the Commands were first shown, and a later Command never takes a number an earlier one had.
  it('numbers each Command once, oldest first, and never reuses a number', async () => {
    const { app, deps } = await appWithJobs();
    checkpoint(deps, ids.job, ULID, { at: '2026-11-04T10:00:00.000Z' });
    checkpoint(deps, ids.linkedJob, MEDIA_ID, { at: '2026-11-04T12:00:00.000Z' });
    const numbered = async () =>
      (
        (await (await get(app, ids.game)).json()) as {
          commands: Array<{ checkpoint_id: string; review_number: number }>;
        }
      ).commands.map(({ checkpoint_id, review_number }) => [checkpoint_id, review_number]);

    expect(await numbered()).toEqual([
      [MEDIA_ID, 2],
      [ULID, 1],
    ]);
    // Listing again changes nothing.
    expect(await numbered()).toEqual([
      [MEDIA_ID, 2],
      [ULID, 1],
    ]);

    // The first Command is answered and leaves the inbox; the next one opened takes 3, not 1.
    deps.sqlite
      .prepare(
        "UPDATE build_chat_messages SET checkpoint_json = json_set(checkpoint_json, '$.status', 'answered') WHERE id = ?",
      )
      .run(ULID);
    const later = '01JBX2Q7M3K8V5N4R6T9W0YZAE';
    checkpoint(deps, ids.job, later, { at: '2026-11-04T13:00:00.000Z' });
    expect(await numbered()).toEqual([
      [later, 3],
      [MEDIA_ID, 2],
    ]);

    // Numbers belong to their game: the other game starts at 1.
    checkpoint(deps, ids.otherJob, '01JBX2Q7M3K8V5N4R6T9W0YZAD');
    const other = (await (await get(app, ids.otherGame)).json()) as { commands: Array<{ review_number: number }> };
    expect(other.commands.map(({ review_number }) => review_number)).toEqual([1]);
  });

  it('leaves out answered, moot, and uncorrelated Commands', async () => {
    const { app, deps } = await appWithJobs();
    checkpoint(deps, ids.job, ULID, { status: 'answered' });
    checkpoint(deps, ids.linkedJob, MEDIA_ID, { decision_id: '' });

    const body = (await (await get(app, ids.game)).json()) as { commands: unknown[] };

    expect(body.commands).toEqual([]);
  });

  it('names the ticket and signs the media an option references', async () => {
    const { app, deps } = await appWithJobs();
    deps.db.update(schema.jobs).set({ aiurIssueNumber: 478 }).run();
    insertChatRow(deps.sqlite, {
      id: '01JBX2Q7M3K8V5N4R6T9W0YZAE',
      jobId: ids.job,
      actor: 'agent',
      kind: 'image',
      media: { hash: `sha256:${'a'.repeat(64)}`, width: 320, height: 200 },
    });
    checkpoint(deps, ids.job, ULID, {
      options: [
        { id: 'wood', label: 'Wooden door', media_id: '01JBX2Q7M3K8V5N4R6T9W0YZAE' },
        { id: 'iron', label: 'Iron door', media_id: '01JBX2Q7M3K8V5N4R6T9W0YZAF' },
      ],
    });

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<{
        ticket: string | null;
        options: Array<{ id: string; media?: { url: string; width: number } }>;
      }>;
    };

    expect(body.commands[0]!.ticket).toBe('478');
    expect(body.commands[0]!.options[0]!.media).toMatchObject({ width: 320 });
    expect(body.commands[0]!.options[0]!.media?.url).toContain('/blobs/');
    // A media id that names no row in this job leaves the option without media.
    expect(body.commands[0]!.options[1]).toEqual({ id: 'iron', label: 'Iron door' });
  });

  it('leaves out a malformed Command instead of failing the whole inbox', async () => {
    const { app, deps } = await appWithJobs();
    checkpoint(deps, ids.job, ULID, { options: [{ id: 'wood', label: 'Wooden door' }] });
    checkpoint(deps, ids.linkedJob, MEDIA_ID, { at: '2026-11-04T12:00:00.000Z' });

    const body = (await (await get(app, ids.game)).json()) as { commands: Array<{ job_id: string }> };

    expect(body.commands.map(({ job_id }) => job_id)).toEqual([ids.linkedJob]);
  });

  it('refuses a game outside the caller’s family', async () => {
    const { app } = await appWithJobs();

    expect((await get(app, ids.game, ids.outsider)).status).toBe(404);
  });

  it('refuses an anonymous caller', async () => {
    const { app } = await appWithJobs();

    expect((await app.request(`/api/v1/games/${ids.game}/commands`)).status).toBe(401);
  });
});

// The answer path the inbox uses is the job's checkpoint route; it must reach aiur's Decision API unchanged.
describe('answering from the inbox', () => {
  it('posts the option through the job checkpoint route', async () => {
    const { app, deps } = await appWithJobs();
    const chatJob = {
      jobId: ids.job,
      gameId: ids.game,
      familyId: ids.family,
      ownerId: ids.user,
      kind: 'feature' as const,
      state: 'running',
      aiur: { daemonSlug: 'game-1', ticket: '478' },
    };
    deps.registry.chatJobs = {
      get: async (jobId) => (jobId === ids.job ? chatJob : null),
      active: async () => [chatJob],
    };
    deps.registry.aiurClientFor = async () =>
      ({ decide: async () => ({ version: 4, status: 'answered' }) }) as unknown as AiurClient;
    checkpoint(deps, ids.job, ULID);
    const inbox = (await (await get(app, ids.game)).json()) as { commands: Array<{ checkpoint_id: string }> };

    const response = await app.request(
      `/api/v1/jobs/${ids.job}/checkpoints/${inbox.commands[0]!.checkpoint_id}/answer`,
      {
        method: 'POST',
        headers: { ...asUser(ids.user), 'content-type': 'application/json' },
        body: JSON.stringify({ option_id: 'wood' }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'answered', option_id: 'wood' });
  });
});

// A game registered from a repository that already exists has its aiur tickets and no jobs, so its open Commands are
// read from the instance's own Decision API. A Command read there has no job, and its answer goes straight to aiur.
const decision = (overrides: Partial<Decision> = {}): Decision => ({
  decision_id: 'd_aiur_1',
  version: 2,
  ticket: { identifier: '478' },
  kind: 'command',
  authority: 'supervisor_allowed',
  blocking: true,
  reversibility: 'reversible',
  question: 'Which blobs?',
  options: [
    { id: 'round', label: 'Round blobs' },
    { id: 'square', label: 'Square blobs' },
  ],
  recommendation: { option_id: 'round' },
  context: { short_summary: 'Blobs look', long_context_markdown: CREATOR_AUDIENCE_MARKER },
  answer: null,
  active_answer: null,
  created_at: '2026-11-04T12:00:00.000Z',
  decision_status: 'open',
  ...overrides,
});

async function appWithAiur(decisions: Decision[], decide = vi.fn(async () => undefined)) {
  const deps = seed();
  deps.aiurClientForGame = async () =>
    ({
      decisions: async () => decisions,
      // A review answer validates its cards against the Command aiur holds, so the client serves one decision too.
      decision: async (id: string) => decisions.find((candidate) => candidate.decision_id === id) ?? decisions[0]!,
      decide,
    }) as unknown as AiurClient;
  const { app } = await makeApp(deps);
  return { app, deps, decide };
}

describe('a registered game’s own Commands', () => {
  it('lists the open Commands its aiur instance holds when no job owns them', async () => {
    const { app } = await appWithAiur([decision()]);

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<Record<string, unknown>>;
    };

    expect(body.commands).toHaveLength(1);
    expect(body.commands[0]).toMatchObject({
      job_id: null,
      ticket: '478',
      title: 'Blobs look',
      checkpoint_id: 'd_aiur_1',
      decision_id: 'd_aiur_1',
      version: 2,
      question: 'Which blobs?',
      recommend: 'round',
      blocking: true,
      opened_at: '2026-11-04T12:00:00.000Z',
    });
  });

  it('leaves a job’s Command to the job and leaves answered and moot Commands out', async () => {
    const { app, deps } = await appWithAiur([
      decision({ decision_id: 'd_job', ticket: { identifier: '99' } }),
      decision({ decision_id: 'd_answered', answer: { option_id: 'round' } }),
      decision({ decision_id: 'd_moot', decision_status: 'moot' }),
      decision({ decision_id: 'd_open', ticket: { identifier: '478' } }),
    ]);
    job(deps, ids.job, ids.game, '2026-11-04T09:00:00.000Z');
    deps.db.update(schema.jobs).set({ aiurIssueNumber: 99 }).run();
    checkpoint(deps, ids.job, ULID, { decision_id: 'd_job' });

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<{ decision_id: string; job_id: string | null }>;
    };

    expect(body.commands).toContainEqual(expect.objectContaining({ decision_id: 'd_job', job_id: ids.job }));
    expect(body.commands).toContainEqual(expect.objectContaining({ decision_id: 'd_open', job_id: null }));
    expect(body.commands.map(({ decision_id }) => decision_id)).not.toContain('d_answered');
    expect(body.commands.map(({ decision_id }) => decision_id)).not.toContain('d_moot');
    // The job's own Command appears once, from its checkpoint.
    expect(body.commands.filter(({ decision_id }) => decision_id === 'd_job')).toHaveLength(1);
  });

  // Kevin (2026-11-08): the creator never sees an engineering question. Until aiur has an audience field, a Command
  // without Game Maker's creator marker is the Executor's, so it stays out of the inbox, its count and the deck.
  it('leaves out a Command that is not marked for the creator', async () => {
    const { app } = await appWithAiur([
      decision({
        decision_id: 'd_engineering',
        question: 'The vision broker returned HTTP 402. Retry or skip?',
        context: { short_summary: 'Vision broker 402' },
      }),
      decision({ decision_id: 'd_no_context', context: {} }),
      decision({ decision_id: 'd_creator' }),
    ]);

    const body = (await (await get(app, ids.game)).json()) as { commands: Array<{ decision_id: string }> };

    expect(body.commands.map(({ decision_id }) => decision_id)).toEqual(['d_creator']);
  });

  it('drops a Command whose options fall outside the inbox contract', async () => {
    const { app } = await appWithAiur([
      decision({ decision_id: 'd_one_option', options: [{ id: 'round', label: 'Round blobs' }] }),
      decision({
        decision_id: 'd_bad_id',
        options: [
          { id: 'Round Blobs', label: 'Round blobs' },
          { id: 'square', label: 'Square blobs' },
        ],
      }),
      decision({ decision_id: 'd_ok' }),
    ]);

    const body = (await (await get(app, ids.game)).json()) as { commands: Array<{ decision_id: string }> };

    expect(body.commands.map(({ decision_id }) => decision_id)).toEqual(['d_ok']);
  });

  it('still lists the jobs’ Commands when the instance cannot be reached', async () => {
    const deps = seed();
    deps.aiurClientForGame = async () => {
      throw new Error('daemon unreachable');
    };
    job(deps, ids.job, ids.game, '2026-11-04T09:00:00.000Z');
    const { app } = await makeApp(deps);
    checkpoint(deps, ids.job, ULID);

    const body = (await (await get(app, ids.game)).json()) as { commands: Array<{ job_id: string }> };

    expect(body.commands.map(({ job_id }) => job_id)).toEqual([ids.job]);
    expect(deps.lines.some((line) => line.event === 'game_commands_unavailable')).toBe(true);
  });

  it('answers a Command with no job through aiur’s Decision API', async () => {
    const { app, decide } = await appWithAiur([decision()]);

    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'square', version: 2 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'answered',
      decision_id: 'd_aiur_1',
      option_id: 'square',
    });
    expect(decide).toHaveBeenCalledWith(
      'd_aiur_1',
      expect.objectContaining({ option: 'square', expected_version: 2, idempotency_key: 'd_aiur_1:2' }),
    );
  });

  it('carries a review deck’s map into aiur and the ledger when no job owns the Command', async () => {
    const { app, deps, decide } = await appWithAiur([decision()]);
    const review = {
      likes: ['round'],
      dislikes: [{ option_id: 'square', reason: 'Too boxy for blobs' }],
      notes: 'Both read too sharp; round is closer.',
    };

    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'round', version: 2, review }),
    });

    expect(response.status).toBe(200);
    expect(decide).toHaveBeenCalledWith(
      'd_aiur_1',
      expect.objectContaining({
        option: 'round',
        response: JSON.stringify({
          kind: 'question_answers',
          answers: [
            { option_id: 'round', verdict: 'like' },
            { option_id: 'square', verdict: 'dislike', reason: 'Too boxy for blobs' },
          ],
          notes: 'Both read too sharp; round is closer.',
        }),
      }),
    );
    // A registered game's Command has no job, so the row records the review with a null job id and the game's title.
    expect(listReviews(deps.db, ids.game)).toEqual([
      expect.objectContaining({
        game_id: ids.game,
        job_id: null,
        title: 'Blobs look',
        checkpoint_id: 'd_aiur_1',
        option_id: 'round',
        likes: [{ option_id: 'round', label: 'Round blobs' }],
        dislikes: [{ option_id: 'square', label: 'Square blobs', reason: 'Too boxy for blobs' }],
        notes: 'Both read too sharp; round is closer.',
      }),
    ]);
  });

  it('refuses a review whose cards are not the Command’s and answers nothing', async () => {
    const { app, decide } = await appWithAiur([decision()]);

    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({
        option_id: 'round',
        version: 2,
        review: { likes: ['round', 'hexagon'], dislikes: [{ option_id: 'square' }] },
      }),
    });

    expect(response.status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });

  it('reports another writer’s answer as a conflict', async () => {
    const { app } = await appWithAiur(
      [decision()],
      vi.fn(async () => {
        throw new AiurHttpError(409, 'conflict');
      }),
    );

    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'square', version: 2 }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'conflict', by: 'other' });
  });

  it('refuses an answer when the game has no aiur instance', async () => {
    const deps = seed();
    deps.aiurClientForGame = async () => {
      throw new HttpError(409, 'daemon_not_found');
    };
    const { app } = await makeApp(deps);

    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'square', version: 2 }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'daemon_not_found' });
  });
});
