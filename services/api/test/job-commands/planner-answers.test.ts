import { expect, it, vi } from 'vitest';
import { schema } from '@ogm/db';

import type { AiurClientResolver, ChatJob } from '../../src/app/registry.js';
import { insertChatRow, updateCommand } from '../../src/build-chat/store.js';
import { createPlannerAnswerSync, plannerAnswers } from '../../src/job-commands/planner-answers.js';
import { createCommandPoller } from '../../src/job-commands/poller.js';
import { ids, insertJob, worked } from '../budget/fixture.js';

it('retries uncertain delivery and shares the latest correction only within the plan', async () => {
  const deps = worked();
  insertJob(deps, { id: 'j_parent', kind: 'new_game' });
  insertJob(deps, { id: 'j_child', idempotencyKey: 'planner:j_parent:one' });
  insertJob(deps, { id: 'j_other', idempotencyKey: 'planner:j_other_parent:one' });
  const row = insertChatRow(deps.sqlite, {
    id: 'm_answer',
    jobId: 'j_parent',
    actor: 'agent',
    kind: 'command',
    command: {
      decision_id: 'decision',
      question: 'Which door?',
      options: [
        { id: 'a', label: 'Wood' },
        { id: 'b', label: 'Iron' },
      ],
      blocking: false,
      status: 'answered',
      option_id: 'a',
      version: 2,
      answer_origin: 'default',
    },
  }).row!;
  const target: ChatJob = {
    jobId: 'j_child',
    gameId: ids.game,
    familyId: ids.family,
    ownerId: ids.creator,
    kind: 'feature',
    state: 'running',
    aiur: { daemonSlug: 'game', ticket: '42' },
  };
  const message = vi
    .fn()
    .mockResolvedValueOnce({ request_id: 'r1', warning: 'outcome_unknown' })
    .mockResolvedValue({ request_id: 'r2' });
  const clientFor = (() => ({ message })) as unknown as AiurClientResolver;
  const sync = createPlannerAnswerSync(deps.db, deps.sqlite);
  await sync(target, clientFor);
  await sync(target, clientFor);
  await sync(target, clientFor);
  expect(message).toHaveBeenCalledTimes(2);
  expect(message.mock.calls[0]![1]).toContain('"origin":"default"');
  expect(message.mock.calls[0]![1]).toContain('provisional');
  expect(message.mock.calls[0]![2]).toBe(message.mock.calls[1]![2]);
  updateCommand(deps.sqlite, row.id, { corrected_option_id: 'b', corrections: 1, answer_origin: 'player' });
  expect(plannerAnswers(deps.db, deps.sqlite, { jobId: 'j_parent', gameId: ids.game })).toMatchObject([
    { source: 'j_parent', answer: 'Iron', origin: 'player' },
  ]);
  await sync(target, clientFor);
  expect(message).toHaveBeenCalledTimes(3);
  expect(message.mock.calls[2]![1]).toContain('Iron');
  expect(message.mock.calls[2]![1]).toContain('"origin":"player"');
  expect(message.mock.calls[2]![2]).not.toBe(message.mock.calls[1]![2]);
  expect(plannerAnswers(deps.db, deps.sqlite, { ...target, jobId: 'j_other' })).toEqual([]);
  deps.sqlite.close();
});

it('continues polling commands when answer delivery stalls', async () => {
  const deps = worked();
  insertJob(deps, { id: 'j_parent', kind: 'new_game' });
  insertJob(deps, { id: 'j_child', idempotencyKey: 'planner:j_parent:one' });
  insertChatRow(deps.sqlite, {
    jobId: 'j_parent',
    actor: 'agent',
    kind: 'command',
    command: {
      decision_id: 'decision',
      question: 'Door?',
      options: [
        { id: 'a', label: 'Wood' },
        { id: 'b', label: 'Iron' },
      ],
      blocking: false,
      status: 'answered',
      option_id: 'a',
    },
  });
  const child: ChatJob = {
    jobId: 'j_child',
    gameId: ids.game,
    familyId: ids.family,
    ownerId: ids.creator,
    kind: 'feature',
    state: 'running',
    aiur: { daemonSlug: 'game', ticket: '42' },
  };
  const message = vi.fn(() => new Promise<never>(() => {}));
  const decisions = vi.fn().mockResolvedValue([]);
  const clientFor = (() => ({ message, decisions })) as unknown as AiurClientResolver;
  const poller = createCommandPoller({
    db: deps.db,
    sqlite: deps.sqlite,
    jobs: () => ({ get: async () => child, active: async () => [child] }),
    clientFor: () => clientFor,
    inbox: { write: async () => undefined },
    publish: () => undefined,
    log: () => undefined,
  });
  await expect(poller.tick()).resolves.toBe(false);
  expect(decisions).toHaveBeenCalledOnce();
  expect(message).toHaveBeenCalledOnce();
  deps.sqlite.close();
});

it('includes later answers from the original creation conversation', () => {
  const deps = worked();
  insertJob(deps, { id: 'j_parent', kind: 'new_game' });
  insertJob(deps, { id: 'j_child', idempotencyKey: 'planner:j_parent:one' });
  deps.db
    .insert(schema.gameDrafts)
    .values({
      id: 'draft1',
      familyId: ids.family,
      creatorId: ids.creator,
      gameId: ids.game,
      choices: '{}',
      status: 'promoted',
      revision: 0,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:00:00.000Z',
    })
    .run();
  insertChatRow(deps.sqlite, {
    jobId: 'draft:draft1',
    actor: 'agent',
    kind: 'command',
    command: {
      decision_id: 'decision',
      question: 'Which world?',
      options: [
        { id: 'a', label: 'Forest' },
        { id: 'b', label: 'Desert' },
      ],
      blocking: false,
      status: 'answered',
      option_id: 'a',
      corrected_option_id: 'b',
      corrections: 1,
    },
  });
  expect(plannerAnswers(deps.db, deps.sqlite, { jobId: 'j_child', gameId: ids.game })).toMatchObject([
    { source: 'draft:draft1', question: 'Which world?', answer: 'Desert' },
  ]);
  deps.sqlite.close();
});
