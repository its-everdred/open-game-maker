import { AiurHttpError, type AiurClient, type Decision } from '@ogm/aiur-client';
import { CREATOR_AUDIENCE_MARKER, decisionKeyMarker, playableMarker, type OptionPlayable } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { HttpError } from '../../src/app/errors.js';
import { insertChatRow } from '../../src/build-chat/store.js';
import { postRound, getRound } from '../../src/review-rounds/store.js';
import { syncCommandVerdicts } from '../../src/review-rounds/command-verdicts.js';
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
        slug: `game-${id.slice(-1)}`,
        githubOwner: 'fixture',
        githubRepo: `game-${id.slice(-1)}`,
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

function command(
  deps: ReturnType<typeof makeDeps>,
  jobId: string,
  id: string,
  overrides: {
    decision_id?: string;
    status?: 'open' | 'answered' | 'moot';
    version?: number | undefined;
    at?: string;
    options?: Array<{
      id: string;
      label: string;
      media_id?: string;
      aiGenerated?: boolean;
      playable?: OptionPlayable;
    }>;
    topic?: string;
  } = {},
) {
  insertChatRow(deps.sqlite, {
    id,
    jobId,
    at: overrides.at ?? AT,
    actor: 'agent',
    kind: 'command',
    command: {
      decision_id: overrides.decision_id ?? `d_${id.slice(-6)}`,
      question: 'Which door?',
      options: overrides.options ?? [
        { id: 'wood', label: 'Wooden door', playable: { scenario: 'door=wood', seconds: 8 } },
        { id: 'iron', label: 'Iron door', playable: { scenario: 'door=iron', seconds: 8 } },
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
    command(deps, ids.job, ULID);
    command(deps, ids.linkedJob, MEDIA_ID, { at: '2026-11-04T12:00:00.000Z' });
    command(deps, ids.otherJob, '01JBX2Q7M3K8V5N4R6T9W0YZAD');

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<{
        job_id: string;
        title: string;
        command_id: string;
        question: string;
        version: number;
        options: unknown;
      }>;
    };

    expect(body.commands.map(({ job_id }) => job_id)).toEqual([ids.linkedJob, ids.job]);
    expect(body.commands[0]).toMatchObject({
      title: 'Job 3',
      command_id: MEDIA_ID,
      question: 'Which door?',
      version: 3,
    });
    expect(body.commands[0]!.options).toEqual([
      { id: 'wood', label: 'Wooden door', playable: { scenario: 'door=wood', seconds: 8 } },
      { id: 'iron', label: 'Iron door', playable: { scenario: 'door=iron', seconds: 8 } },
    ]);
  });

  it('titles a Command with its own topic, and an older one without a topic with its job', async () => {
    const { app, deps } = await appWithJobs();
    command(deps, ids.job, ULID, { topic: 'Front door material' });
    command(deps, ids.linkedJob, MEDIA_ID);

    const body = (await (await get(app, ids.game)).json()) as { commands: Array<{ job_id: string; title: string }> };

    expect(body.commands).toContainEqual(expect.objectContaining({ job_id: ids.job, title: 'Front door material' }));
    expect(body.commands).toContainEqual(expect.objectContaining({ job_id: ids.linkedJob, title: 'Job 3' }));
  });

  // The short link `/<slug>/review/<n>` (#591) must keep opening the same Command: a number is given once, in the
  // order the Commands were first shown, and a later Command never takes a number an earlier one had.
  it('numbers each Command once, oldest first, and never reuses a number', async () => {
    const { app, deps } = await appWithJobs();
    command(deps, ids.job, ULID, { at: '2026-11-04T10:00:00.000Z' });
    command(deps, ids.linkedJob, MEDIA_ID, { at: '2026-11-04T12:00:00.000Z' });
    const numbered = async () =>
      (
        (await (await get(app, ids.game)).json()) as {
          commands: Array<{ command_id: string; review_number: number }>;
        }
      ).commands.map(({ command_id, review_number }) => [command_id, review_number]);

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
        "UPDATE build_chat_messages SET command_json = json_set(command_json, '$.status', 'answered') WHERE id = ?",
      )
      .run(ULID);
    const later = '01JBX2Q7M3K8V5N4R6T9W0YZAE';
    command(deps, ids.job, later, { at: '2026-11-04T13:00:00.000Z' });
    expect(await numbered()).toEqual([
      [later, 3],
      [MEDIA_ID, 2],
    ]);

    // Numbers belong to their game: the other game starts at 1.
    command(deps, ids.otherJob, '01JBX2Q7M3K8V5N4R6T9W0YZAD');
    const other = (await (await get(app, ids.otherGame)).json()) as { commands: Array<{ review_number: number }> };
    expect(other.commands.map(({ review_number }) => review_number)).toEqual([1]);
  });

  it('leaves out answered, moot, and uncorrelated Commands', async () => {
    const { app, deps } = await appWithJobs();
    command(deps, ids.job, ULID, { status: 'answered' });
    command(deps, ids.linkedJob, MEDIA_ID, { decision_id: '' });

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
    command(deps, ids.job, ULID, {
      options: [
        {
          id: 'wood',
          label: 'Wooden door',
          media_id: '01JBX2Q7M3K8V5N4R6T9W0YZAE',
          playable: { scenario: 'door=wood', seconds: 8 },
        },
        { id: 'iron', label: 'Iron door', media_id: '01JBX2Q7M3K8V5N4R6T9W0YZAF' },
      ],
    });

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<{
        ticket: string | null;
        options: Array<{ id: string; media?: { url: string; width: number } }>;
      }>;
    };

    // A media id that names no row in this job makes the whole Command incomplete.
    expect(body.commands).toEqual([]);

    insertChatRow(deps.sqlite, {
      id: '01JBX2Q7M3K8V5N4R6T9W0YZAF',
      jobId: ids.job,
      actor: 'agent',
      kind: 'image',
      media: { hash: `sha256:${'b'.repeat(64)}`, width: 240, height: 160 },
    });
    const complete = (await (await get(app, ids.game)).json()) as {
      commands: Array<{
        ticket: string | null;
        options: Array<{ id: string; media?: { url: string; width: number } }>;
      }>;
    };
    expect(complete.commands[0]!.ticket).toBe('478');
    expect(complete.commands[0]!.options[0]!.media).toMatchObject({ width: 320 });
    expect(complete.commands[0]!.options[0]!.media?.url).toContain('/blobs/');
    expect(complete.commands[0]!.options[1]!.media).toMatchObject({ width: 240 });
  });

  // A gameplay-feel question (#608) is answered by playing each option, so the card needs the scenario the agent set.
  it('carries an option’s playable slice to the deck', async () => {
    const { app, deps } = await appWithJobs();
    const slow = { scenario: 'scenario=sandbox&speed=slow', seconds: 6, lead_in: 'one-chain' };
    command(deps, ids.job, ULID, {
      options: [
        { id: 'slow', label: 'Slow', playable: slow },
        { id: 'fast', label: 'Fast', playable: { scenario: 'scenario=sandbox&speed=fast', seconds: 8 } },
      ],
    });

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<{ options: Array<{ id: string; playable?: OptionPlayable }> }>;
    };

    expect(body.commands[0]!.options[0]).toEqual({ id: 'slow', label: 'Slow', playable: slow });
    expect(body.commands[0]!.options[1]!.playable?.scenario).toBe('scenario=sandbox&speed=fast');
  });

  it('carries an option’s generated-asset marker to every review surface', async () => {
    const { app, deps } = await appWithJobs();
    command(deps, ids.job, ULID, {
      options: [
        { id: 'generated', label: 'Generated mock', aiGenerated: true, playable: { scenario: 'a=a', seconds: 8 } },
        { id: 'authored', label: 'Authored mock', playable: { scenario: 'b=b', seconds: 8 } },
      ],
    });

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<{ options: Array<{ id: string; aiGenerated?: boolean }> }>;
    };

    expect(body.commands[0]!.options).toEqual([
      { id: 'generated', label: 'Generated mock', aiGenerated: true, playable: { scenario: 'a=a', seconds: 8 } },
      { id: 'authored', label: 'Authored mock', playable: { scenario: 'b=b', seconds: 8 } },
    ]);
  });

  it('leaves out a malformed Command instead of failing the whole inbox', async () => {
    const { app, deps } = await appWithJobs();
    command(deps, ids.job, ULID, { options: [{ id: 'wood', label: 'Wooden door' }] });
    command(deps, ids.linkedJob, MEDIA_ID, { at: '2026-11-04T12:00:00.000Z' });

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

// The answer path the inbox uses is the job's Command route; it must reach aiur's Decision API unchanged.
describe('answering from the inbox', () => {
  it('posts the option through the job command route', async () => {
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
    command(deps, ids.job, ULID);
    const inbox = (await (await get(app, ids.game)).json()) as { commands: Array<{ command_id: string }> };

    const response = await app.request(`/api/v1/jobs/${ids.job}/commands/${inbox.commands[0]!.command_id}/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'wood' }),
    });

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
  context: {
    short_summary: 'Blobs look',
    long_context_markdown: `${CREATOR_AUDIENCE_MARKER}\n${playableMarker(
      new Map([
        ['round', { scenario: 'blobs=round', seconds: 8 }],
        ['square', { scenario: 'blobs=square', seconds: 8 }],
      ]),
    )}`,
  },
  answer: null,
  active_answer: null,
  created_at: '2026-11-04T12:00:00.000Z',
  decision_status: 'open',
  ...overrides,
});

async function appWithAiur(decisions: Decision[], answerAsCreator = vi.fn(async () => undefined)) {
  const deps = seed();
  deps.registry.trackerTickets = async (repo) => ({
    stale: false,
    tickets: decisions.map((item) => ({
      ticket: item.ticket.identifier,
      title: 'Ticket',
      labels: [`game:${repo.name}`],
      closedAt: null,
      updatedAt: AT,
      outcome: 'Closed',
      url: 'https://example.test/issue',
    })),
  });
  deps.aiurClientForGame = async () =>
    ({
      decisions: async () => decisions,
      // A review answer validates its cards against the Command aiur holds, so the client serves one decision too.
      decision: async (id: string) => decisions.find((candidate) => candidate.decision_id === id) ?? decisions[0]!,
      // A supervisor answer is what aiur refused with 403 (#631); the inbox must never send one.
      decide: vi.fn(async () => {
        throw new AiurHttpError(403, 'supervisor_forbidden');
      }),
      answerAsCreator,
    }) as unknown as AiurClient;
  const { app } = await makeApp(deps);
  return { app, deps, answerAsCreator };
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
      command_id: 'd_aiur_1',
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
    command(deps, ids.job, ULID, { decision_id: 'd_job' });

    const body = (await (await get(app, ids.game)).json()) as {
      commands: Array<{ decision_id: string; job_id: string | null }>;
    };

    expect(body.commands).toContainEqual(expect.objectContaining({ decision_id: 'd_job', job_id: ids.job }));
    expect(body.commands).toContainEqual(expect.objectContaining({ decision_id: 'd_open', job_id: null }));
    expect(body.commands.map(({ decision_id }) => decision_id)).not.toContain('d_answered');
    expect(body.commands.map(({ decision_id }) => decision_id)).not.toContain('d_moot');
    // The job's own Command appears once, from its build chat.
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
    command(deps, ids.job, ULID);

    const body = (await (await get(app, ids.game)).json()) as { commands: Array<{ job_id: string }> };

    expect(body.commands.map(({ job_id }) => job_id)).toEqual([ids.job]);
    expect(deps.lines.some((line) => line.event === 'game_commands_unavailable')).toBe(true);
  });

  it('answers a Command with no job as the creator, under a grant for its ticket', async () => {
    const { app, answerAsCreator } = await appWithAiur([decision()]);

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
    expect(answerAsCreator).toHaveBeenCalledWith(
      'd_aiur_1',
      expect.objectContaining({
        ticket: '478',
        principal: ids.user,
        option: 'square',
        expected_version: 2,
        idempotency_key: 'd_aiur_1:2',
      }),
    );
  });

  it('carries a review deck’s map into aiur and the ledger when no job owns the Command', async () => {
    const { app, deps, answerAsCreator } = await appWithAiur([
      decision({ context: { long_context_markdown: CREATOR_AUDIENCE_MARKER } }),
    ]);
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
    // aiur takes one of an option or a response: the review answers with its map alone.
    expect(answerAsCreator.mock.calls[0]![1]).not.toHaveProperty('option');
    expect(answerAsCreator).toHaveBeenCalledWith(
      'd_aiur_1',
      expect.objectContaining({
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
        title: 'Which blobs?',
        command_id: 'd_aiur_1',
        option_id: 'round',
        likes: [{ option_id: 'round', label: 'Round blobs' }],
        dislikes: [{ option_id: 'square', label: 'Square blobs', reason: 'Too boxy for blobs' }],
        notes: 'Both read too sharp; round is closer.',
      }),
    ]);
  });

  it('carries a liked option note even when that is the only vote', async () => {
    const { app, answerAsCreator } = await appWithAiur([decision()]);
    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({
        option_id: 'round',
        version: 2,
        review: { likes: ['round'], dislikes: [], liked_notes: [{ option_id: 'round', reason: 'Favorite' }] },
      }),
    });

    expect(response.status).toBe(200);
    expect(answerAsCreator).toHaveBeenCalledWith(
      'd_aiur_1',
      expect.objectContaining({
        response: JSON.stringify({
          kind: 'question_answers',
          answers: [{ option_id: 'round', verdict: 'like', note: 'Favorite' }],
        }),
      }),
    );
  });

  it('records a keyed round change request with its notes', async () => {
    const item = decision({
      options: [
        { id: 'round', label: 'Round' },
        { id: 'needs_work', label: 'Needs work' },
      ],
      context: {
        short_summary: 'Blobs look',
        long_context_markdown: `${CREATOR_AUDIENCE_MARKER}\n${decisionKeyMarker('round-id')}`,
      },
    });
    const { app, deps, answerAsCreator } = await appWithAiur([item]);
    postRound(deps.db, {
      id: 'round-id',
      gameId: ids.game,
      track: 'art',
      phase: 'concept',
      category: 'art',
      round: 1,
      ticket: '478',
      sha: 'a'.repeat(40),
      media: '[]',
      postedAt: AT,
    });
    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({
        option_id: 'round',
        version: 2,
        change_request: true,
        review: { likes: [], dislikes: [{ option_id: 'round' }], notes: 'Softer edges' },
      }),
    });
    expect(response.status).toBe(200);
    const sent = answerAsCreator.mock.calls[0]![1] as { response: string };
    expect(JSON.parse(sent.response)).toMatchObject({
      answers: [{ option_id: 'needs_work', verdict: 'like' }],
      notes: 'Softer edges',
    });
    item.answer = { custom_response: sent.response, actor: { kind: 'operator', id: ids.user } };
    await syncCommandVerdicts(
      deps.db,
      deps.aiurClientForGame,
      () => AT,
      () => {},
    );
    expect(getRound(deps.db, ids.game, 'round-id')).toMatchObject({ verdict: 'needs_work', notes: 'Softer edges' });
    expect(listReviews(deps.db, ids.game)).toEqual([
      expect.objectContaining({ option_id: 'needs_work', notes: 'Softer edges' }),
    ]);
  });

  it('retries a ledger failure with the same idempotency key after Aiur accepted', async () => {
    const item = decision();
    const { app, deps, answerAsCreator } = await appWithAiur([item]);
    deps.sqlite.exec(
      `CREATE TRIGGER reject_review BEFORE INSERT ON command_reviews BEGIN SELECT RAISE(FAIL, 'unavailable'); END`,
    );
    const request = () =>
      app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
        method: 'POST',
        headers: { ...asUser(ids.user), 'content-type': 'application/json' },
        body: JSON.stringify({ option_id: 'round', version: 2, review: { likes: ['round'], dislikes: [] } }),
      });
    expect((await request()).status).toBe(503);
    item.answer = { option_id: 'round' };
    deps.sqlite.exec('DROP TRIGGER reject_review');
    expect((await request()).status).toBe(200);
    expect(answerAsCreator).toHaveBeenCalledTimes(2);
    expect(answerAsCreator.mock.calls.map((call) => (call[1] as { idempotency_key: string }).idempotency_key)).toEqual([
      'd_aiur_1:2',
      'd_aiur_1:2',
    ]);
    expect(listReviews(deps.db, ids.game)).toHaveLength(1);
  });

  it('recovers the ledger from an accepted answer after its response is lost', async () => {
    const item = decision();
    const answer = vi.fn(async () => {
      item.answer = { option_id: 'round', actor: { kind: 'operator', id: ids.user } };
      throw new Error('response lost');
    });
    const { app, deps } = await appWithAiur([item], answer);
    deps.registry.trackerTickets = async () => ({
      stale: false,
      tickets: [
        {
          ticket: '478',
          title: 'Ticket',
          labels: ['game:game-1', 'agent:human-review'],
          closedAt: null,
          updatedAt: AT,
          outcome: 'Closed',
          url: 'https://example.test/issue',
        },
      ],
    });
    deps.registry.reviewEpisode = async () => '100@2026-01-01T00:00:00Z';
    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'round', version: 2, review: { likes: ['round'], dislikes: [] } }),
    });
    expect(response.status).toBe(502);
    expect(listReviews(deps.db, ids.game)).toHaveLength(0);
    const missing = await app.request(`/api/v1/games/${ids.game}/tickets/478/missing-review`, {
      method: 'POST',
      headers: asUser(ids.user),
    });
    expect(missing.status).toBe(409);
    expect(listReviews(deps.db, ids.game)).toEqual([
      expect.objectContaining({ decision_id: 'd_aiur_1', option_id: 'round' }),
    ]);
  });

  it('installs the guard before waiting for tracker history', async () => {
    let finish!: (episode: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const { app, deps } = await appWithAiur([decision()]);
    const read = vi.fn(async () => pending);
    deps.registry.reviewEpisode = read;
    const request = app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'round', version: 2, review: { likes: ['round'], dislikes: [] } }),
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    expect(deps.db.select().from(schema.reviewAnswerGuards).all()).toEqual([
      expect.objectContaining({
        source: ids.game,
        ticket: expect.stringMatching(/^478\/pending@/),
        episode: expect.stringContaining('"principal"'),
      }),
    ]);
    finish('101@2026-01-01T00:01:00Z');
    expect((await request).status).toBe(200);
  });

  it('guards the review episode active after an in-flight answer', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const answer = vi.fn(async () => pending);
    const { app, deps } = await appWithAiur([decision()], answer);
    let episode = '100@2026-01-01T00:00:00Z';
    deps.registry.reviewEpisode = async () => episode;
    const request = app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'round', version: 2, review: { likes: ['round'], dislikes: [] } }),
    });
    await vi.waitFor(() => expect(answer).toHaveBeenCalled());
    expect(deps.db.select().from(schema.reviewAnswerGuards).all()).toEqual([
      expect.objectContaining({
        source: ids.game,
        ticket: expect.stringMatching(/^478\/pending@/),
        episode: expect.stringContaining('"principal"'),
      }),
    ]);
    episode = '101@2026-01-01T00:01:00Z';
    finish();
    expect((await request).status).toBe(200);
    expect(deps.db.select().from(schema.reviewAnswerGuards).all()).toEqual([
      expect.objectContaining({ source: ids.game, ticket: '478', episode }),
    ]);
  });

  it('retains the owning job when a creator answers its review', async () => {
    const { app, deps, answerAsCreator } = await appWithAiur([
      decision({ context: { long_context_markdown: CREATOR_AUDIENCE_MARKER } }),
    ]);
    job(deps, ids.job, ids.game, AT);
    deps.db.update(schema.jobs).set({ aiurIssueNumber: 478 }).run();
    command(deps, ids.job, ULID, {
      decision_id: 'd_aiur_1',
      options: [
        { id: 'round', label: 'Round blobs' },
        { id: 'square', label: 'Square blobs' },
      ],
    });
    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'round', version: 2, review: { likes: ['round'], dislikes: [] } }),
    });
    expect(response.status).toBe(200);
    expect(answerAsCreator).toHaveBeenCalledWith('d_aiur_1', expect.objectContaining({ option: 'round' }));
    expect(listReviews(deps.db, ids.game)).toEqual([expect.objectContaining({ job_id: ids.job, command_id: ULID })]);
  });

  it('refuses a review whose cards are not the Command’s and answers nothing', async () => {
    const { app, answerAsCreator } = await appWithAiur([decision()]);

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
    expect(answerAsCreator).not.toHaveBeenCalled();
  });

  // The creator's answer grant is scoped to the Command's ticket (#631): a Command aiur cannot place on a ticket, or one
  // outside the inbox contract, is refused before any grant is minted.
  it('refuses an answer to a Command it cannot place on a ticket and answers nothing', async () => {
    const { app, answerAsCreator } = await appWithAiur([
      decision({ decision_id: 'd_aiur_1', options: [{ id: 'square', label: 'Square blobs' }] }),
    ]);

    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'square', version: 2 }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'command_not_found' });
    expect(answerAsCreator).not.toHaveBeenCalled();
  });

  it('does not answer an Executor decision or an option outside the Command', async () => {
    const technical = await appWithAiur([decision({ context: {} })]);
    const request = (app: typeof technical.app, option_id: string) =>
      app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
        method: 'POST',
        headers: { ...asUser(ids.user), 'content-type': 'application/json' },
        body: JSON.stringify({ option_id, version: 2 }),
      });
    expect((await request(technical.app, 'round')).status).toBe(404);
    expect(technical.answerAsCreator).not.toHaveBeenCalled();
    const creator = await appWithAiur([decision()]);
    expect((await request(creator.app, 'unknown')).status).toBe(400);
    expect(creator.answerAsCreator).not.toHaveBeenCalled();
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

it('omits a Command with options missing media from the creator inbox', async () => {
  const incomplete = decision({ context: { long_context_markdown: CREATOR_AUDIENCE_MARKER } });
  const { app, deps } = await appWithAiur([incomplete]);
  const message = vi.fn().mockResolvedValue({ request_id: 'r' });
  deps.aiurClientForGame = async () =>
    ({ decisions: async () => [incomplete], decision: async () => incomplete, message }) as unknown as AiurClient;
  const path = `/api/v1/games/${ids.game}/commands/d_aiur_1/missing-media`;
  const inbox = (await (await get(app, ids.game)).json()) as {
    commands: unknown[];
    missing_media_commands: Array<{ game_id: string; decision_id: string }>;
  };
  expect(inbox.commands).toEqual([]);
  expect(inbox.missing_media_commands).toContainEqual({ game_id: ids.game, decision_id: 'd_aiur_1' });
  const reviewFeed = (await (
    await app.request('/api/v1/me/commands?includeQuestions=1', { headers: asUser(ids.user) })
  ).json()) as { commands: unknown[]; missing_media_commands: Array<{ game_id: string; decision_id: string }> };
  expect(reviewFeed.commands).toEqual([]);
  expect(reviewFeed.missing_media_commands).toContainEqual({ game_id: ids.game, decision_id: 'd_aiur_1' });
  expect((await app.request(path, { method: 'POST', headers: asUser(ids.outsider) })).status).toBeGreaterThanOrEqual(
    400,
  );
  expect(message).not.toHaveBeenCalled();
  expect((await app.request(path, { method: 'POST', headers: asUser(ids.user) })).status).toBe(200);
  expect(message).toHaveBeenCalledWith(
    '478',
    expect.stringContaining('missing media'),
    'review-media:d_aiur_1:2',
    expect.any(AbortSignal),
  );
});

it('does not advertise ticketless incomplete Commands as media-repair actions', async () => {
  const ticketless = decision({
    ticket: null,
    context: { long_context_markdown: CREATOR_AUDIENCE_MARKER },
  });
  const { app } = await appWithAiur([ticketless]);
  const reviewFeed = (await (
    await app.request('/api/v1/me/commands?includeQuestions=1', { headers: asUser(ids.user) })
  ).json()) as { missing_media_commands: Array<{ game_id: string; decision_id: string }> };
  expect(reviewFeed.missing_media_commands).toEqual([]);
});

it('keeps playable-only reviews out of the missing-media repair feed', async () => {
  const { app } = await appWithAiur([decision()]);
  const reviewFeed = (await (
    await app.request('/api/v1/me/commands?includeQuestions=1', { headers: asUser(ids.user) })
  ).json()) as { commands: Array<{ decision_id: string }>; missing_media_commands: unknown[] };
  expect(reviewFeed.commands).toContainEqual(expect.objectContaining({ decision_id: 'd_aiur_1' }));
  expect(reviewFeed.missing_media_commands).toEqual([]);
});

it('lists and answers core Commands only for the instance owner', async () => {
  const { app, deps } = await appWithAiur([]);
  deps.registry.coreAiurClient = {} as AiurClient;
  expect((await app.request('/api/v1/me/core-commands', { headers: asUser(ids.user) })).status).toBe(403);
  deps.config.instanceOwnerId = ids.user;
  deps.config.coreRepo = { owner: 'fixture', name: 'core' };
  deps.registry.trackerTickets = async () => ({
    stale: false,
    tickets: [
      {
        ticket: '479',
        title: 'Review core build',
        labels: ['agent:human-review'],
        closedAt: null,
        updatedAt: AT,
        outcome: 'Closed',
        url: 'https://example.test/issue',
      },
    ],
  });
  const coreDecision = decision({
    audience: 'creator',
    context: { short_summary: 'Blobs look' },
    options: [
      {
        id: 'round',
        label: 'Round blobs',
        media: [{ kind: 'image', locator: { kind: 'url', value: 'https://example.test/a.png' } }],
      },
      {
        id: 'square',
        label: 'Square blobs',
        media: [{ kind: 'image', locator: { kind: 'url', value: 'https://example.test/b.png' } }],
      },
    ],
  });
  const answerAsCreator = vi.fn().mockResolvedValue(undefined);
  const message = vi.fn().mockResolvedValue({ request_id: 'r' });
  deps.registry.coreAiurClient = {
    decisions: vi.fn().mockResolvedValue([coreDecision]),
    decision: vi.fn().mockResolvedValue(coreDecision),
    state: vi.fn().mockResolvedValue({
      running: [],
      retrying: [],
      idle: [{ issue_identifier: '479', state: 'agent:human-review', title: 'Review core build' }],
    }),
    issue: vi.fn().mockResolvedValue({ status: 'in-progress' }),
    answerAsCreator,
    message,
  } as unknown as AiurClient;
  const pcDecision = decision({ decision_id: 'd_pc_9', ticket: { identifier: '7' } });
  const pcAnswer = vi.fn().mockResolvedValue(undefined);
  deps.registry.coreAiurClients = [
    { id: 'core', client: deps.registry.coreAiurClient, repo: deps.config.coreRepo },
    {
      id: 'pc',
      client: {
        decisions: vi.fn().mockResolvedValue([pcDecision]),
        decision: vi.fn().mockResolvedValue(pcDecision),
        issue: vi.fn().mockResolvedValue({ status: 'open' }),
        answerAsCreator: pcAnswer,
      } as unknown as AiurClient,
      repo: { owner: 'fixture', name: 'pc-core' },
    },
  ];
  expect((await app.request('/api/v1/me/core-commands', { headers: asUser(ids.outsider) })).status).toBe(403);
  const page = await app.request('/api/v1/me/core-commands', { headers: asUser(ids.user) });
  const pageBody = await page.json();
  expect(pageBody).toMatchObject({
    targets: expect.arrayContaining([
      expect.objectContaining({ source: 'core', daemon: 'core', ticket: '479', title: 'Review core build' }),
    ]),
    commands: expect.arrayContaining([
      expect.objectContaining({ source: 'core', daemon: 'core', decision_id: 'd_aiur_1' }),
    ]),
  });
  expect(pageBody.commands).toEqual(
    expect.arrayContaining([expect.objectContaining({ decision_id: 'd_pc_9', daemon: 'pc' })]),
  );
  expect(
    await (await app.request('/api/v1/core/tickets/7/state?daemon=pc', { headers: asUser(ids.user) })).json(),
  ).toEqual({ state: 'open' });
  const pcAnswerResponse = await app.request('/api/v1/core/commands/d_pc_9/answer?daemon=pc', {
    method: 'POST',
    headers: { ...asUser(ids.user), 'content-type': 'application/json' },
    body: JSON.stringify({ option_id: 'round', version: 2 }),
  });
  expect(pcAnswerResponse.status).toBe(200);
  expect(pcAnswer).toHaveBeenCalled();
  const pcEntry = deps.registry.coreAiurClients[1]!;
  deps.registry.coreAiurClients[1] = {
    ...pcEntry,
    client: { decisions: vi.fn().mockRejectedValue(new AiurHttpError(503, 'unavailable')) } as unknown as AiurClient,
  };
  const pcDown = await (await app.request('/api/v1/me/core-commands', { headers: asUser(ids.user) })).json();
  expect(pcDown).toMatchObject({
    targetsUnavailable: true,
    commands: expect.arrayContaining([expect.objectContaining({ daemon: 'core' })]),
  });
  deps.registry.coreAiurClients[1] = pcEntry;
  deps.registry.reviewEpisode = async () => '100@2026-01-01T00:00:00Z';
  const originalTracker = deps.registry.trackerTickets!;
  deps.registry.trackerTickets = async () => ({ stale: true, tickets: [] });
  const partial = await (await app.request('/api/v1/me/core-commands', { headers: asUser(ids.user) })).json();
  expect(partial).toMatchObject({
    targetsUnavailable: true,
    commands: expect.arrayContaining([expect.objectContaining({ decision_id: 'd_aiur_1' })]),
  });
  expect(
    (await app.request('/api/v1/core/tickets/479/missing-review', { method: 'POST', headers: asUser(ids.user) }))
      .status,
  ).toBe(503);
  deps.registry.trackerTickets = originalTracker;
  const path = '/api/v1/core/commands/d_aiur_1/answer';
  const request = () =>
    app.request(path, {
      method: 'POST',
      headers: { ...asUser(ids.user), 'content-type': 'application/json' },
      body: JSON.stringify({ option_id: 'square', version: 2, review: { likes: ['square'], dislikes: [] } }),
    });
  expect((await request()).status).toBe(200);
  const changed = await app.request(path, {
    method: 'POST',
    headers: { ...asUser(ids.user), 'content-type': 'application/json' },
    body: JSON.stringify({
      option_id: 'square',
      version: 2,
      change_request: true,
      review: { likes: [], dislikes: [{ option_id: 'square' }], notes: 'Softer' },
    }),
  });
  expect(changed.status).toBe(200);
  expect(answerAsCreator).toHaveBeenCalledWith(
    'd_aiur_1',
    expect.objectContaining({ response: expect.stringContaining('Softer') }),
  );
  expect(answerAsCreator).toHaveBeenCalledWith(
    'd_aiur_1',
    expect.objectContaining({
      ticket: '478',
      principal: ids.user,
      expected_version: 2,
      idempotency_key: 'd_aiur_1:2',
      option: 'square',
    }),
  );
  expect(
    (await app.request('/api/v1/core/commands/d_aiur_1/missing-media', { method: 'POST', headers: asUser(ids.user) }))
      .status,
  ).toBe(409);
  expect(message).not.toHaveBeenCalled();
  expect(
    (await app.request('/api/v1/core/tickets/479/missing-review', { method: 'POST', headers: asUser(ids.user) }))
      .status,
  ).toBe(200);
  expect(message).toHaveBeenCalledWith(
    '479',
    expect.stringContaining('no review media'),
    'core-review-target:479:100',
    expect.any(AbortSignal),
  );
  expect(await (await app.request('/api/v1/core/tickets/478/state', { headers: asUser(ids.user) })).json()).toEqual({
    state: 'in-progress',
  });
  deps.registry.trackerTickets = async () => ({
    stale: false,
    tickets: [
      {
        ticket: '478',
        title: 'Review',
        labels: ['agent:human-review'],
        closedAt: null,
        updatedAt: AT,
        outcome: 'Closed',
        url: 'https://example.test/issue',
      },
    ],
  });
  const pending = await app.request('/api/v1/core/tickets/478/missing-review', {
    method: 'POST',
    headers: asUser(ids.user),
  });
  expect(pending.status).toBe(409);
  deps.registry.coreAiurClient = null;
  deps.registry.coreAiurClients = [];
  expect((await app.request('/api/v1/me/core-commands', { headers: asUser(ids.user) })).status).toBe(503);
});

it('does not report a declared attachment as absent while its copy is pending', async () => {
  const { app, deps } = await appWithAiur([]);
  const withMedia = decision({
    options: [
      {
        id: 'round',
        label: 'Round blobs',
        media: [{ kind: 'image', locator: { kind: 'attachment', attachment_id: 'a' } }],
      },
      {
        id: 'square',
        label: 'Square blobs',
        media: [{ kind: 'image', locator: { kind: 'attachment', attachment_id: 'b' } }],
      },
    ],
  });
  deps.registry.trackerTickets = async () => ({
    stale: false,
    tickets: [
      {
        ticket: '478',
        title: 'Ticket',
        labels: ['game:game-1'],
        closedAt: null,
        updatedAt: AT,
        outcome: 'Closed',
        url: 'https://example.test/issue',
      },
    ],
  });
  const message = vi.fn().mockResolvedValue({ request_id: 'r' });
  const { aiurMediaTiming } = await import('../../src/commands/aiur-media.js');
  const original = aiurMediaTiming.inboxWaitMs;
  aiurMediaTiming.inboxWaitMs = 1;
  deps.aiurClientForGame = async () =>
    ({
      decisions: async () => [withMedia],
      decision: async () => withMedia,
      baseUrl: 'http://127.0.0.1:1',
      decisionMedia: () => new Promise(() => {}),
      message,
    }) as unknown as AiurClient;
  try {
    const response = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/missing-media`, {
      method: 'POST',
      headers: asUser(ids.user),
    });
    expect(response.status).toBe(409);
    expect(message).not.toHaveBeenCalled();
  } finally {
    aiurMediaTiming.inboxWaitMs = original;
  }
});

it('does not expose a core daemon error or its connection details', async () => {
  const { app, deps } = await appWithAiur([]);
  deps.config.instanceOwnerId = ids.user;
  deps.registry.coreAiurClient = {
    decisions: vi.fn().mockRejectedValue(new Error('private-core-value')),
  } as unknown as AiurClient;
  const response = await app.request('/api/v1/me/core-commands', { headers: asUser(ids.user) });
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('private-core-value');
});

it('does not list or answer another game’s decision on a shared daemon', async () => {
  const { app, deps, answerAsCreator } = await appWithAiur([decision()]);
  deps.registry.trackerTickets = async () => ({
    stale: false,
    tickets: [
      {
        ticket: '478',
        title: 'Other game',
        labels: ['game:game-2'],
        closedAt: null,
        updatedAt: AT,
        outcome: 'Closed',
        url: 'https://example.test/issue',
      },
    ],
  });
  const listed = await app.request(`/api/v1/games/${ids.game}/commands`, { headers: asUser(ids.user) });
  expect(await listed.json()).toMatchObject({ commands: [] });
  const missing = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/missing-media`, {
    method: 'POST',
    headers: asUser(ids.user),
  });
  expect(missing.status).toBe(404);
  const answer = await app.request(`/api/v1/games/${ids.game}/commands/d_aiur_1/answer`, {
    method: 'POST',
    headers: { ...asUser(ids.user), 'content-type': 'application/json' },
    body: JSON.stringify({ option_id: 'round', version: 2 }),
  });
  expect(answer.status).toBe(404);
  expect(answerAsCreator).not.toHaveBeenCalled();
});
