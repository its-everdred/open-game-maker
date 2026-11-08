import type { AiurClient } from '@ogm/aiur-client';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '../../src/app/types.js';
import { findCheckpoint, insertChatRow, parseCheckpoint } from '../../src/build-chat/store.js';
import { answerCheckpoint } from '../../src/checkpoints/answer.js';
import { answerVoiceCommand } from '../../src/voice/command-answer.js';
import { ids, insertJob, NOW, worked } from '../budget/fixture.js';
import { makeApp } from '../helpers.js';

const target = {
  kind: 'build' as const,
  game_id: ids.game,
  job_id: ids.running,
  ticket: '7',
  creator_id: ids.creator,
};
const scopeTarget = {
  kind: 'scope' as const,
  game_id: ids.game,
  session_id: 'scope-voice-1',
  creator_id: ids.creator,
};

function fixture() {
  const deps = worked();
  deps.db
    .update(schema.jobs)
    .set({ aiurRepo: 'owner/game', aiurIssueNumber: 7 })
    .where(eq(schema.jobs.id, ids.running))
    .run();
  deps.db
    .insert(schema.checkpoints)
    .values({
      decisionId: 'decision-1',
      jobId: ids.running,
      daemonSlug: 'owner-game',
      version: 3,
      question: 'Ship it?',
      options: JSON.stringify([
        { id: 'ship', label: 'Ship it' },
        { id: 'wait', label: 'Wait' },
      ]),
      status: 'open',
      openedAt: NOW.toISOString(),
    })
    .run();
  deps.db
    .insert(schema.scopeSessions)
    .values({
      id: scopeTarget.session_id,
      gameId: ids.game,
      creatorId: ids.creator,
      jobId: ids.running,
      status: 'open',
      revision: 0,
      choices: '[]',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run();
  return deps;
}

// The same Command as the build chat holds it: the row the game's inbox and the review deck read.
async function withChatCheckpoint(deps: ReturnType<typeof fixture>) {
  insertChatRow(deps.sqlite, {
    jobId: ids.running,
    actor: 'agent',
    kind: 'checkpoint',
    text: 'Ship it?',
    checkpoint: {
      checkpoint_id: 'cp-voice-1',
      decision_id: 'decision-1',
      version: 3,
      question: 'Ship it?',
      options: [
        { id: 'ship', label: 'Ship it' },
        { id: 'wait', label: 'Wait' },
      ],
      status: 'open',
    },
  });
  const job = {
    jobId: ids.running,
    gameId: ids.game,
    familyId: 'family',
    ownerId: ids.creator,
    kind: 'feature' as const,
    state: 'running' as const,
    aiur: { daemonSlug: 'owner-game', ticket: '7' },
  };
  deps.registry.chatJobs = {
    get: async (jobId: string) => (jobId === job.jobId ? job : null),
    active: async () => [job],
  } as unknown as NonNullable<AppDeps['registry']['chatJobs']>;
  const decide = vi.fn().mockResolvedValue({ decision_id: 'decision-1', version: 4, decision_status: 'answered' });
  const message = vi.fn().mockResolvedValue({ request_id: 'r1' });
  deps.registry.aiurClientFor = () => ({ decide, message }) as never;
  const direct = vi.fn();
  deps.aiurClientForGame = async () => ({ decide: direct }) as never;
  // The app wires the checkpoint inbox and chat hub the shared answer path writes to.
  await makeApp(deps);
  return { decide, direct, message };
}

describe('answerVoiceCommand', () => {
  // Kevin (#597): clicked, typed and spoken answers write one decision record. A spoken answer that only reached aiur
  // left the inbox showing the Command open, so the review deck offered it again and a click then hit a conflict.
  it('writes a spoken answer to the same record a click writes', async () => {
    const deps = fixture();
    const { decide, direct } = await withChatCheckpoint(deps);

    await expect(
      answerVoiceCommand(deps, {
        target,
        command_id: 'decision-1',
        choice: 'ship it',
        idempotency_key: 'voice-call-9',
      }),
    ).resolves.toEqual({ status: 'answered' });

    expect(direct).not.toHaveBeenCalled();
    // The click's idempotency key, so a click and a spoken answer of the same card are one aiur answer.
    expect(decide).toHaveBeenCalledWith(
      'decision-1',
      expect.objectContaining({
        option: 'ship',
        expected_version: 3,
        idempotency_key: 'ogm:player:cp-voice-1:3',
        rationale: "Creator chose 'Ship it' in two-way voice",
      }),
    );
    const row = findCheckpoint(deps.sqlite, ids.running, 'decision-1');
    expect(row && parseCheckpoint(row)).toMatchObject({ status: 'answered', option_id: 'ship' });
    expect(deps.db.select().from(schema.checkpoints).get()).toMatchObject({ status: 'answered' });
  });

  // Kevin (#597): a saved answer can be corrected. aiur keeps the answer it was given, so a change to a build job's
  // Command reaches the job's ticket as one message and the chat row holds the answer that now stands. Before, any
  // change on a non-design job was refused as a conflict and the creator's correction was lost.
  it('tells the job ticket when the creator changes a saved answer, and back again', async () => {
    const deps = fixture();
    const { decide, message } = await withChatCheckpoint(deps);
    const row = () => findCheckpoint(deps.sqlite, ids.running, 'decision-1')!;
    deps.sqlite
      .prepare('UPDATE build_chat_messages SET checkpoint_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...parseCheckpoint(row()), status: 'answered', option_id: 'wait' }), row().id);

    await expect(
      answerVoiceCommand(deps, { target, command_id: 'decision-1', choice: 'ship', idempotency_key: 'voice-call-10' }),
    ).resolves.toEqual({ status: 'answered' });
    expect(decide).not.toHaveBeenCalled();
    expect(message).toHaveBeenLastCalledWith(
      '7',
      'The creator changed their answer to "Ship it?": "Ship it" now stands instead of "Wait". Follow the new answer.',
      expect.any(String),
    );
    expect(parseCheckpoint(row())).toMatchObject({ status: 'answered', option_id: 'ship' });

    // Changing back compares against the answer that now stands, so the ticket hears that too.
    const job = (await deps.registry.chatJobs!.get(ids.running))!;
    await expect(
      answerCheckpoint({ deps, job, row: row(), optionId: 'wait', source: 'player' }),
    ).resolves.toMatchObject({ kind: 'superseded', optionId: 'wait' });
    expect(message).toHaveBeenCalledTimes(2);
    expect(message.mock.calls[1]![1]).toContain('"Wait" now stands instead of "Ship it"');
    expect(parseCheckpoint(row())).toMatchObject({ option_id: 'wait' });
  });

  it('routes a spoken option through the Aiur Decision API and closes the local Command', async () => {
    const deps = fixture();
    const decide = vi.fn().mockResolvedValue({ decision_id: 'decision-1' });
    deps.aiurClientForGame = async () => ({ decide }) as never;

    await expect(
      answerVoiceCommand(deps, {
        target,
        command_id: 'decision-1',
        choice: 'Ship it',
        idempotency_key: 'voice-call-1',
      }),
    ).resolves.toEqual({ status: 'answered' });

    expect(decide).toHaveBeenCalledWith(
      'decision-1',
      expect.objectContaining({ option: 'ship', expected_version: 3, idempotency_key: 'voice-call-1' }),
    );
    expect(deps.db.select().from(schema.checkpoints).get()).toMatchObject({
      status: 'answered',
      answeredAt: expect.any(String),
    });
  });

  it('requires the internal credential before the HTTP route can answer', async () => {
    const deps = fixture();
    deps.config.voiceInternalSecret = 'voice-internal-secret-for-tests';
    const decide = vi.fn().mockResolvedValue({ decision_id: 'decision-1' });
    deps.aiurClientForGame = async () => ({ decide }) as unknown as AiurClient;
    const { app } = await makeApp(deps);
    const body = JSON.stringify({
      target,
      command_id: 'decision-1',
      choice: 'ship',
      idempotency_key: 'voice-call-route',
    });

    const refused = await app.request('/internal/voice/command-answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ogm-internal': 'wrong' },
      body,
    });
    expect(refused.status).toBe(401);
    expect(decide).not.toHaveBeenCalled();

    const answered = await app.request('/internal/voice/command-answer', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ogm-internal': 'voice-internal-secret-for-tests',
      },
      body,
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ status: 'answered' });
  });

  it('answers the same game Command from a valid scope conversation', async () => {
    const deps = fixture();
    insertJob(deps, {
      id: 'j_18000000-0000-4000-8000-000000000099',
      creatorId: ids.other,
      createdAt: '2026-10-31T20:01:00.000Z',
      updatedAt: '2026-10-31T20:01:00.000Z',
    });
    const decide = vi.fn().mockResolvedValue({ decision_id: 'decision-1' });
    deps.aiurClientForGame = async () => ({ decide }) as never;

    await expect(
      answerVoiceCommand(deps, {
        target: scopeTarget,
        command_id: 'decision-1',
        choice: 'ship',
        idempotency_key: 'voice-call-scope',
      }),
    ).resolves.toEqual({ status: 'answered' });
    expect(decide).toHaveBeenCalledWith('decision-1', expect.objectContaining({ option: 'ship' }));
  });

  it('returns stale without calling Aiur when the Command is no longer open', async () => {
    const deps = fixture();
    deps.db.update(schema.checkpoints).set({ status: 'answered' }).run();
    const decide = vi.fn();
    deps.aiurClientForGame = async () => ({ decide }) as never;

    await expect(
      answerVoiceCommand(deps, {
        target,
        command_id: 'decision-1',
        choice: 'ship',
        idempotency_key: 'voice-call-2',
      }),
    ).resolves.toEqual({ status: 'stale' });
    expect(decide).not.toHaveBeenCalled();
  });

  it('rejects a forged target and an unknown option before contacting Aiur', async () => {
    const deps = fixture();
    const decide = vi.fn();
    deps.aiurClientForGame = async () => ({ decide }) as never;

    await expect(
      answerVoiceCommand(deps, {
        target: { ...target, ticket: '8' },
        command_id: 'decision-1',
        choice: 'ship',
        idempotency_key: 'voice-call-3',
      }),
    ).resolves.toEqual({ status: 'failed' });
    await expect(
      answerVoiceCommand(deps, {
        target,
        command_id: 'decision-1',
        choice: 'delete everything',
        idempotency_key: 'voice-call-4',
      }),
    ).resolves.toEqual({ status: 'failed' });
    await expect(
      answerVoiceCommand(deps, {
        target: { ...scopeTarget, session_id: 'scope-forged' },
        command_id: 'decision-1',
        choice: 'ship',
        idempotency_key: 'voice-call-5',
      }),
    ).resolves.toEqual({ status: 'failed' });
    expect(decide).not.toHaveBeenCalled();
  });
});
