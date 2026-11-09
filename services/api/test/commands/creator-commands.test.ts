import type { AiurClient, Decision } from '@ogm/aiur-client';
import { CREATOR_AUDIENCE_MARKER } from '@ogm/contracts';
import { schema } from '@ogm/db';
import { describe, expect, it, vi } from 'vitest';

import { insertChatRow } from '../../src/build-chat/store.js';
import { AIUR_LIST_TIMEOUT_MS } from '../../src/commands/aiur.js';
import { createInboxWriter } from '../../src/job-commands/inbox.js';
import { createCommandPoller } from '../../src/job-commands/poller.js';
import type { AppDeps } from '../../src/app/types.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

// Kevin (2026-11-08): the creator's menu shows how many decisions are open across all their games and walks through
// them, and it shows player-facing decisions only. An engineering question (a provider's HTTP 402, a CI check) goes to
// the Executor; until aiur has an audience field, a decision without Game Maker's creator marker stays out of creator views.

const ids = {
  family: 'f_70000000-0000-4000-8000-000000000001',
  user: 'u_70000000-0000-4000-8000-000000000001',
  outsider: 'u_70000000-0000-4000-8000-000000000002',
  otherFamily: 'f_70000000-0000-4000-8000-000000000003',
  blobs: 'g_70000000-0000-4000-8000-000000000001',
  castle: 'g_70000000-0000-4000-8000-000000000002',
  foreign: 'g_70000000-0000-4000-8000-000000000003',
  job: 'j_70000000-0000-4000-8000-000000000001',
  shared: 'g_70000000-0000-4000-8000-000000000004',
  member: 'u_70000000-0000-4000-8000-000000000004',
};

const AT = '2026-11-08T10:00:00.000Z';

function seed() {
  const deps = makeDeps();
  for (const [family, owner] of [
    [ids.family, ids.user],
    [ids.otherFamily, ids.outsider],
  ] as const) {
    deps.db.insert(schema.families).values({ id: family, name: 'Family', ownerUserId: owner, createdAt: AT }).run();
    deps.db
      .insert(schema.familyMembers)
      .values({ familyId: family, userId: owner, role: 'owner', capability: 'creator', joinedAt: AT })
      .run();
  }
  for (const [id, familyId, ownerId, title] of [
    [ids.blobs, ids.family, ids.user, 'Blobs'],
    [ids.castle, ids.family, ids.user, 'Castle'],
    [ids.foreign, ids.otherFamily, ids.outsider, 'Elsewhere'],
  ] as const) {
    deps.db
      .insert(schema.games)
      .values({ id, familyId, ownerId, title, visibility: 'private', repoVisibility: 'private', createdAt: AT })
      .run();
  }
  installUsers(
    deps,
    [
      [ids.user, ids.family],
      [ids.outsider, ids.otherFamily],
    ].map(([userId, familyId]) => ({
      kind: 'user' as const,
      userId: userId!,
      familyId: familyId!,
      platformRole: 'none' as const,
      capability: 'creator' as const,
      email: `${userId}@example.test`,
    })),
  );
  return deps;
}

const decision = (id: string, overrides: Partial<Decision> = {}): Decision => ({
  decision_id: id,
  version: 1,
  ticket: { identifier: '12' },
  kind: 'command',
  authority: 'human_required',
  blocking: false,
  reversibility: 'reversible',
  question: `Question ${id}?`,
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  recommendation: { option_id: 'a' },
  context: { short_summary: `Topic ${id}`, long_context_markdown: CREATOR_AUDIENCE_MARKER },
  answer: null,
  active_answer: null,
  created_at: AT,
  decision_status: 'open',
  ...overrides,
});

// Each game's own aiur instance answers with the decisions given for it.
function serveAiur(deps: ReturnType<typeof makeDeps>, byGame: Record<string, Decision[]>) {
  deps.aiurClientForGame = async (gameId: string) =>
    ({ decisions: async () => byGame[gameId] ?? [] }) as unknown as AiurClient;
}

async function read(deps: ReturnType<typeof makeDeps>, path: string, userId: string = ids.user) {
  const { app } = await makeApp(deps);
  return app.request(`/api/v1${path}`, { headers: asUser(userId) });
}

describe('the creator’s decision inbox', () => {
  it('lists every game’s player-facing Commands, blocking first and then the longest waiting', async () => {
    const deps = seed();
    serveAiur(deps, {
      [ids.blobs]: [
        decision('d_new', { created_at: '2026-11-08T12:00:00.000Z' }),
        decision('d_old', { created_at: '2026-11-08T08:00:00.000Z' }),
      ],
      [ids.castle]: [decision('d_block', { blocking: true, created_at: '2026-11-08T13:00:00.000Z' })],
      [ids.foreign]: [decision('d_foreign')],
    });

    const response = await read(deps, '/me/commands');
    const body = (await response.json()) as { commands: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.commands.map((command) => command.decision_id)).toEqual(['d_block', 'd_old', 'd_new']);
    expect(body.commands[0]).toMatchObject({
      game_id: ids.castle,
      game_title: 'Castle',
      title: 'Topic d_block',
      summary: 'Topic d_block',
      job_id: null,
    });
  });

  it('leaves out a decision with no creator audience, from the menu and from the game’s inbox', async () => {
    const deps = seed();
    serveAiur(deps, {
      [ids.blobs]: [
        decision('d_player'),
        decision('d_engineering', { context: { short_summary: 'Vision broker returns 402' } }),
        decision('d_ops', { context: { short_summary: 'Rotate token' } }),
      ],
    });

    const menu = (await (await read(deps, '/me/commands')).json()) as { commands: Array<{ decision_id: string }> };
    const inbox = (await (await read(deps, `/games/${ids.blobs}/commands`)).json()) as {
      commands: Array<{ decision_id: string }>;
    };

    expect(menu.commands.map((command) => command.decision_id)).toEqual(['d_player']);
    expect(inbox.commands.map((command) => command.decision_id)).toEqual(['d_player']);
  });

  // One game's instance that never answers must not stall every other game's decisions in the menu.
  it('lists the other games’ decisions when one game’s instance hangs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const deps = seed();
      let hung: AbortSignal | undefined;
      deps.aiurClientForGame = async (gameId: string) =>
        ({
          decisions: async (_query: unknown, signal?: AbortSignal) => {
            if (gameId !== ids.blobs) return [decision('d_castle')];
            hung = signal;
            return new Promise<Decision[]>(() => undefined);
          },
        }) as unknown as AiurClient;

      const pending = read(deps, '/me/commands');
      await vi.advanceTimersByTimeAsync(AIUR_LIST_TIMEOUT_MS + 1);
      const body = (await (await pending).json()) as { commands: Array<{ decision_id: string }> };

      expect(body.commands.map((command) => command.decision_id)).toEqual(['d_castle']);
      expect(deps.lines).toContainEqual(
        expect.objectContaining({ event: 'game_commands_unavailable', gameId: ids.blobs }),
      );
      // The hung request is cancelled too, so a wedged instance does not hold one open socket per menu poll.
      expect(hung?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // A game that fails to list (a bad row, a media signing error) must not empty the menu for every other game.
  it('lists the other games’ decisions when one game fails to list', async () => {
    const deps = seed();
    serveAiur(deps, { [ids.blobs]: [decision('d_blobs')], [ids.castle]: [decision('d_castle')] });
    // A stored job whose plan no longer reads back makes Blobs fail to list.
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
        plan: '{',
        reservation: '{',
        hardCapMicroUsd: 500_000,
        usageMicroUsd: 0,
        idempotencyKey: 'key-broken',
        createdAt: AT,
        updatedAt: AT,
      })
      .run();

    const response = await read(deps, '/me/commands');
    const body = (await response.json()) as { commands: Array<{ decision_id: string }> };

    expect(response.status).toBe(200);
    expect(body.commands.map((command) => command.decision_id)).toEqual(['d_castle']);
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'creator_commands_game_failed', gameId: ids.blobs }),
    );
  });

  // The menu lists only games the caller may edit: a family game another member owns stays out until it is shared.
  it('leaves out a family game the caller may see but not edit', async () => {
    const deps = seed();
    deps.db
      .insert(schema.familyMembers)
      .values({ familyId: ids.family, userId: ids.member, role: 'member', capability: 'creator', joinedAt: AT })
      .run();
    deps.db
      .insert(schema.games)
      .values({
        id: ids.shared,
        familyId: ids.family,
        ownerId: ids.member,
        title: 'Theirs',
        visibility: 'listed',
        repoVisibility: 'private',
        createdAt: AT,
      })
      .run();
    serveAiur(deps, { [ids.shared]: [decision('d_theirs')], [ids.blobs]: [decision('d_mine')] });

    const body = (await (await read(deps, '/me/commands')).json()) as { commands: Array<{ decision_id: string }> };

    expect(body.commands.map((command) => command.decision_id)).toEqual(['d_mine']);
  });

  it('refuses an anonymous caller', async () => {
    const { app } = await makeApp(seed());
    expect((await app.request('/api/v1/me/commands')).status).toBe(401);
  });
});

describe('a job’s Commands in the decision inbox', () => {
  function seedJob(deps: ReturnType<typeof makeDeps>) {
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
  }

  function pollerFor(deps: ReturnType<typeof makeDeps>, decisions: Decision[]) {
    return createCommandPoller({
      db: deps.db,
      sqlite: deps.sqlite,
      jobs: () =>
        ({
          get: async () => null,
          active: async () => [
            {
              jobId: ids.job,
              gameId: ids.blobs,
              familyId: ids.family,
              ownerId: ids.user,
              kind: 'feature',
              state: 'running',
              aiur: { daemonSlug: 'blobs', ticket: '12' },
            },
          ],
        }) as unknown as NonNullable<AppDeps['registry']['chatJobs']>,
      clientFor: () => async () => ({ decisions: async () => decisions }) as unknown as AiurClient,
      inbox: createInboxWriter({ sqlite: deps.sqlite, log: deps.log }),
      publish: () => undefined,
      log: deps.log,
    });
  }

  function storeCommand(deps: ReturnType<typeof makeDeps>, commandId: string, decisionId: string) {
    insertChatRow(deps.sqlite, {
      jobId: ids.job,
      at: AT,
      actor: 'agent',
      kind: 'command',
      command: {
        command_id: commandId,
        decision_id: decisionId,
        version: 1,
        question: 'Which door?',
        options: [
          { id: 'wood', label: 'Wooden door' },
          { id: 'iron', label: 'Iron door' },
        ],
        status: 'open',
      },
    });
  }

  // A decision mirrored before aiur marked it for the creator (or before this app read the mark) is stored without an
  // audience. The next poll must catch it up, or it stays hidden from the creator for good.
  it('catches a stored mirrored decision up with the audience and topic aiur gives it later', async () => {
    const deps = seed();
    serveAiur(deps, {});
    seedJob(deps);
    storeCommand(deps, 'd_legacy', 'd_legacy');
    expect((await (await read(deps, '/me/commands')).json()) as unknown).toEqual({ commands: [] });

    await pollerFor(deps, [
      decision('d_legacy', {
        kind: 'native_question',
        context: { short_summary: 'Door style', long_context_markdown: CREATOR_AUDIENCE_MARKER },
      }),
    ]).tick();
    const body = (await (await read(deps, '/me/commands')).json()) as { commands: Array<Record<string, unknown>> };

    expect(body.commands).toEqual([expect.objectContaining({ decision_id: 'd_legacy', summary: 'Door style' })]);
  });

  // `gm command request` sends the same placeholder topic for every question; taking it would label every builder
  // question in the menu alike, so a builder's Command keeps its job's title.
  it('keeps a builder’s command on its job’s title, not the builder’s placeholder topic', async () => {
    const deps = seed();
    serveAiur(deps, {});
    seedJob(deps);
    storeCommand(deps, 'cp_builder', 'd_builder');

    await pollerFor(deps, [
      decision('d_builder', { context: { short_summary: 'Direction command for the creator' } }),
    ]).tick();
    const body = (await (await read(deps, '/me/commands')).json()) as { commands: Array<Record<string, unknown>> };

    expect(body.commands).toEqual([expect.objectContaining({ decision_id: 'd_builder', title: 'Add the moon gate' })]);
    expect(body.commands[0]).not.toHaveProperty('summary');
  });

  // The poller mirrors the job ticket's aiur decisions into Commands; the creator audience and the short topic must
  // survive that copy, or every mirrored decision would vanish from the menu (or every one would show).
  it('keeps a mirrored decision’s audience and topic, and shows only the creator’s', async () => {
    const deps = seed();
    serveAiur(deps, {});
    seedJob(deps);
    const decisions = [
      decision('d_mirror_player', {
        kind: 'native_question',
        context: { short_summary: 'Gate colour', long_context_markdown: CREATOR_AUDIENCE_MARKER },
      }),
      decision('d_mirror_eng', { kind: 'native_question', context: { short_summary: 'CI is red' } }),
    ];
    const poller = pollerFor(deps, decisions);

    await poller.tick();
    // Only the creator's decision is mirrored (#595), so only it reaches the menu.
    expect(deps.sqlite.prepare(`SELECT id FROM build_chat_messages WHERE kind = 'command'`).all()).toHaveLength(1);
    const body = (await (await read(deps, '/me/commands')).json()) as { commands: Array<Record<string, unknown>> };

    expect(body.commands).toEqual([
      expect.objectContaining({
        decision_id: 'd_mirror_player',
        job_id: ids.job,
        title: 'Gate colour',
        summary: 'Gate colour',
        game_title: 'Blobs',
      }),
    ]);
  });

  it('keeps a builder’s own command, which asks the player by construction', async () => {
    const deps = seed();
    serveAiur(deps, {});
    seedJob(deps);
    storeCommand(deps, 'cp_builder', 'd_builder');

    const body = (await (await read(deps, '/me/commands')).json()) as { commands: Array<{ decision_id: string }> };

    expect(body.commands.map((command) => command.decision_id)).toEqual(['d_builder']);
  });
});
