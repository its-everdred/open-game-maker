import type { AiurClient, Decision } from '@ogm/aiur-client';
import { CREATOR_AUDIENCE_MARKER, CREATOR_TEXT_ONLY_MARKER } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import type { AppDeps } from '../../src/app/types.js';
import { createInboxWriter } from '../../src/checkpoints/inbox.js';
import { createCheckpointPoller } from '../../src/checkpoints/poller.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

// Kevin (2026-11-08): a words-only question is never shown to the creator one by one. Product questions queue per game,
// and once five (configurable) are waiting the inbox gets one entry offering a quick two-way voice chat instead.

const ids = {
  family: 'f_71000000-0000-4000-8000-000000000001',
  user: 'u_71000000-0000-4000-8000-000000000001',
  blobs: 'g_71000000-0000-4000-8000-000000000001',
  castle: 'g_71000000-0000-4000-8000-000000000002',
  job: 'j_71000000-0000-4000-8000-000000000001',
};
const AT = '2026-11-09T10:00:00.000Z';
const QUESTION = `${CREATOR_AUDIENCE_MARKER}\n${CREATOR_TEXT_ONLY_MARKER}`;

function seed() {
  const deps = makeDeps();
  // Product questions queue only where they can be asked: the voice host is configured.
  Object.assign(deps.config, { voiceTokenSecret: 'v'.repeat(32), voiceWsUrl: 'wss://voice.example.test' });
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.user, createdAt: AT })
    .run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: ids.family, userId: ids.user, role: 'owner', capability: 'creator', joinedAt: AT })
    .run();
  for (const [id, title] of [
    [ids.blobs, 'Blobs'],
    [ids.castle, 'Castle'],
  ] as const) {
    deps.db
      .insert(schema.games)
      .values({
        id,
        familyId: ids.family,
        ownerId: ids.user,
        title,
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: AT,
      })
      .run();
  }
  installUsers(deps, [
    {
      kind: 'user' as const,
      userId: ids.user,
      familyId: ids.family,
      platformRole: 'none' as const,
      capability: 'creator' as const,
      email: 'creator@example.test',
    },
  ]);
  return deps;
}

const decision = (id: string, markdown: string, overrides: Partial<Decision> = {}): Decision => ({
  decision_id: id,
  version: 1,
  ticket: { identifier: '12' },
  kind: 'command',
  authority: 'human_required',
  blocking: true,
  reversibility: 'reversible',
  question: `Question ${id}?`,
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  recommendation: { option_id: 'a' },
  context: { short_summary: `Topic ${id}`, long_context_markdown: markdown },
  answer: null,
  active_answer: null,
  created_at: AT,
  decision_status: 'open',
  ...overrides,
});

const questions = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => decision(`${prefix}${index}`, QUESTION));

function serveAiur(deps: ReturnType<typeof makeDeps>, byGame: Record<string, Decision[]>) {
  deps.aiurClientForGame = async (gameId: string) =>
    ({ decisions: async () => byGame[gameId] ?? [] }) as unknown as AiurClient;
}

type Page = { commands: Array<{ decision_id: string }>; question_sessions?: unknown[] };

async function read(deps: ReturnType<typeof makeDeps>, path: string): Promise<Page> {
  const { app } = await makeApp(deps);
  return (await (await app.request(`/api/v1${path}`, { headers: asUser(ids.user) })).json()) as Page;
}

describe('the product-question queue', () => {
  it('keeps product questions out of the decisions and offers a voice chat once five are queued', async () => {
    const deps = seed();
    serveAiur(deps, {
      [ids.blobs]: [decision('d_look', CREATOR_AUDIENCE_MARKER), ...questions('q_blobs_', 5)],
      [ids.castle]: questions('q_castle_', 4),
    });

    const menu = await read(deps, '/me/commands');
    expect(menu.commands.map(({ decision_id }) => decision_id)).toEqual(['d_look']);
    // Castle has four: below the threshold, so nothing is offered for it yet.
    expect(menu.question_sessions).toEqual([{ game_id: ids.blobs, game_title: 'Blobs', count: 5 }]);
    const inbox = await read(deps, `/games/${ids.blobs}/commands`);
    expect(inbox.commands.map(({ decision_id }) => decision_id)).toEqual(['d_look']);
  });

  // Without a voice host there is no voice chat to ask them in, so they must not vanish: they show like any decision.
  it('lists product questions one by one when voice is not configured', async () => {
    const deps = seed();
    Object.assign(deps.config, { voiceTokenSecret: undefined, voiceWsUrl: undefined });
    serveAiur(deps, { [ids.blobs]: questions('q_blobs_', 5) });

    const menu = await read(deps, '/me/commands');
    expect(menu.commands).toHaveLength(5);
    expect(menu.question_sessions).toEqual([]);
  });

  it('takes the threshold from configuration', async () => {
    const deps = seed();
    deps.config.voiceQuestionsAt = 2;
    serveAiur(deps, { [ids.castle]: questions('q_castle_', 2) });

    expect((await read(deps, '/me/commands')).question_sessions).toEqual([
      { game_id: ids.castle, game_title: 'Castle', count: 2 },
    ]);
  });

  it('ignores the text-only mark on a decision that is not the creator’s', async () => {
    const deps = seed();
    deps.config.voiceQuestionsAt = 1;
    serveAiur(deps, { [ids.blobs]: [decision('d_ops', CREATOR_TEXT_ONLY_MARKER)] });

    expect(await read(deps, '/me/commands')).toEqual({ commands: [], question_sessions: [] });
  });

  // `gm ask` raises a plain decision with no checkpoint, so on a build's ticket it must be mirrored into the job and
  // still be counted as queued rather than shown as a words-only decision.
  it('mirrors a product question on a build’s ticket and queues it', async () => {
    const deps = seed();
    deps.config.voiceQuestionsAt = 1;
    serveAiur(deps, {});
    deps.db
      .insert(schema.jobs)
      .values({
        id: ids.job,
        gameId: ids.blobs,
        branchId: 'main',
        familyId: ids.family,
        creatorId: ids.user,
        kind: 'feature',
        complexity: 2,
        state: 'running',
        start: 'now',
        slot: 'edit',
        aiurIssueNumber: 12,
        plan: JSON.stringify({
          title: 'Add the moon gate',
          summary: 'Add the moon gate',
          scope: { included: ['moon gate'], excluded: [] },
          targetControls: [],
          tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['loads'] }],
        }),
        reservation: JSON.stringify({ amountMicroUsd: 500_000, sizeClass: 'small', confidence: 'high' }),
        hardCapMicroUsd: 500_000,
        usageMicroUsd: 0,
        idempotencyKey: 'key-job',
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    const job = {
      jobId: ids.job,
      gameId: ids.blobs,
      familyId: ids.family,
      ownerId: ids.user,
      kind: 'feature',
      state: 'running',
      aiur: { daemonSlug: 'blobs', ticket: '12' },
    };
    const chatJobs = {
      get: async (jobId: string) => (jobId === ids.job ? job : null),
      active: async () => [job],
    } as unknown as NonNullable<AppDeps['registry']['chatJobs']>;
    deps.registry.chatJobs = chatJobs;
    const poller = createCheckpointPoller({
      db: deps.db,
      sqlite: deps.sqlite,
      jobs: () => chatJobs,
      clientFor: () => async () =>
        ({
          decisions: async () => [decision('q_job', QUESTION, { kind: 'direction_checkpoint' })],
        }) as unknown as AiurClient,
      inbox: createInboxWriter({ sqlite: deps.sqlite, log: deps.log }),
      publish: () => undefined,
      log: deps.log,
    });
    await poller.tick();

    expect(await read(deps, '/me/commands')).toEqual({
      commands: [],
      question_sessions: [{ game_id: ids.blobs, game_title: 'Blobs', count: 1 }],
    });
    // Nor is it shown one by one as a card in the build's chat.
    const chat = (await (
      await (await makeApp(deps)).app.request(`/api/v1/jobs/${ids.job}/chat/messages`, { headers: asUser(ids.user) })
    ).json()) as { messages: Array<{ kind: string }>; last_seq: number };
    expect(chat.messages.filter(({ kind }) => kind === 'checkpoint')).toEqual([]);
    expect(chat.last_seq).toBeGreaterThan(0);
  });
});
