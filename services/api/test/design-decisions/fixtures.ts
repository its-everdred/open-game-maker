import type { AiurClient, Decision, DecisionAnswer } from '@ogm/aiur-client';
import { schema } from '@ogm/db';

import { insertChatRow } from '../../src/build-chat/store.js';
import type { AppDeps } from '../../src/app/types.js';
import { users } from '../build-chat/setup.js';

export const NOW = '2026-11-04T18:00:00.000Z';
export const GAME = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e01';
export const FAMILY = users.owner.familyId;
export const OWNER = users.owner.userId;
// The creation chat's own ticket: the design conversation runs here until the request exists.
export const SCOPE_JOB = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
// The New Game request whose parent issue the Executor owns.
export const PARENT_JOB = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e71';
export const PARENT_TICKET = 42;
export const CP_ID = 'cp_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e72';
export const DECISION_ID = 'd_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e73';

const PLAN = JSON.stringify({
  title: 'Lantern Bay',
  summary: 'A cozy island platformer about relighting harbour lanterns.',
  scope: { included: ['lanterns'], excluded: ['multiplayer'] },
  tickets: [{ key: 'T1', skills: ['gm-core'], dependsOn: [], acceptanceCriteria: ['it glows'] }],
});

function jobRow(id: string, kind: 'new_game' | 'scope', extra: Record<string, unknown> = {}) {
  return {
    id,
    gameId: GAME,
    branchId: 'main',
    familyId: FAMILY,
    creatorId: OWNER,
    kind,
    complexity: kind === 'scope' ? 1 : 3,
    state: 'filed' as const,
    start: 'now' as const,
    slot: kind === 'new_game' ? ('new_game' as const) : ('edit' as const),
    plan: PLAN,
    reservation: JSON.stringify({ amountMicroUsd: 9_000_001, sizeClass: 'large', confidence: 'low' }),
    hardCapMicroUsd: 12_000_000,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

// The game, its creation chat and its filed request: the rows a design decision's foreign keys need, plus the parent
// ticket the Executor reads.
export function seedDesignGame(deps: AppDeps): void {
  deps.db.insert(schema.families).values({ id: FAMILY, name: 'Family', ownerUserId: OWNER, createdAt: NOW }).run();
  deps.db
    .insert(schema.games)
    .values({
      id: GAME,
      familyId: FAMILY,
      ownerId: OWNER,
      title: 'Lantern Bay',
      slug: 'lantern-bay',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: NOW,
    })
    .run();
  deps.db.insert(schema.jobs).values(jobRow(SCOPE_JOB, 'scope')).run();
  deps.db
    .insert(schema.jobs)
    .values(jobRow(PARENT_JOB, 'new_game', { aiurRepo: 'owner/game', aiurIssueNumber: PARENT_TICKET }))
    .run();
}

export type OpenCommand = {
  id?: string;
  commandId?: string;
  decisionId?: string;
  version?: number;
  question?: string;
  options?: { id: string; label: string }[];
  // `null` leaves the Command without a recommendation; omit it for the default `iron`.
  recommend?: string | null;
  at?: string;
};

// An open design Command in the creation chat, correlated to an aiur decision so the sweep may answer it.
export function insertOpenDesignCommand(deps: AppDeps, overrides: OpenCommand = {}): string {
  const row = insertChatRow(deps.sqlite, {
    id: overrides.id,
    jobId: SCOPE_JOB,
    at: overrides.at ?? NOW,
    actor: 'agent',
    kind: 'command',
    text: overrides.question ?? 'Which door?',
    command: {
      command_id: overrides.commandId ?? CP_ID,
      decision_id: overrides.decisionId ?? DECISION_ID,
      version: overrides.version ?? 2,
      question: overrides.question ?? 'Which door?',
      options: overrides.options ?? [
        { id: 'wood', label: 'Wooden' },
        { id: 'iron', label: 'Iron' },
      ],
      ...(overrides.recommend === null ? {} : { recommend: overrides.recommend ?? 'iron' }),
      blocking: true,
      status: 'open',
    },
  }).row;
  if (row === null) throw new Error('command row not stored');
  return row.id;
}

export function answeredDecision(optionId: string): Decision {
  return {
    decision_id: DECISION_ID,
    version: 2,
    ticket: { identifier: String(PARENT_TICKET) },
    kind: 'direction_checkpoint',
    authority: 'supervisor_allowed',
    blocking: true,
    reversibility: 'reversible',
    question: 'Which door?',
    options: [
      { id: 'wood', label: 'Wooden' },
      { id: 'iron', label: 'Iron' },
    ],
    recommendation: { option_id: 'iron', reason: 'Fits the castle' },
    context: { long_context_markdown: `<!-- gm-command:${CP_ID} -->` },
    created_at: NOW,
    decision_status: 'decided',
    answer: { selected_option_id: optionId },
  } as Decision;
}

export type FakeAiur = Pick<AiurClient, 'message' | 'progress' | 'decisions' | 'decision' | 'decide'>;

export type ExecutorMessage = { ticket: string; text: string; messageId?: string };
export type FakeDaemon = FakeAiur & { messages: ExecutorMessage[] };

// A daemon client that accepts every decision with the chosen option and records the Executor messages it receives.
export function fakeAiur(): FakeDaemon {
  const messages: ExecutorMessage[] = [];
  return {
    messages,
    message: async (ticket: string, text: string, messageId?: string) => {
      messages.push({ ticket, text, messageId });
      return { request_id: 'r_test' };
    },
    progress: async () => [],
    decisions: async () => [],
    decision: async () => answeredDecision('iron'),
    decide: async (_id: string, answer: DecisionAnswer) => answeredDecision(answer.option ?? ''),
  } as unknown as FakeDaemon;
}
