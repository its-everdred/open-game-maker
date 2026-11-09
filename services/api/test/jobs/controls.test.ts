import { AiurConfigError, AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app/app.js';
import type { IssueStateWriter } from '../../src/app/registry.js';
import { createControlsRoutes } from '../../src/jobs/controls.js';
import { asUser, installUsers, makeDeps } from '../helpers.js';

const NOW = new Date('2026-11-01T22:00:00.000Z');
const ids = { family: 'f_1', owner: 'u_1', other: 'u_2', game: 'g_1', job: 'j_1' };

function setup(state: 'queued' | 'filed' | 'running' | 'paused_budget' = 'running') {
  const deps = makeDeps();
  deps.db
    .insert(schema.families)
    .values({ id: ids.family, name: 'Family', ownerUserId: ids.owner, createdAt: NOW.toISOString() })
    .run();
  for (const userId of [ids.owner, ids.other]) {
    deps.db
      .insert(schema.familyMembers)
      .values({
        familyId: ids.family,
        userId,
        role: userId === ids.owner ? 'owner' : 'member',
        capability: 'creator',
        joinedAt: NOW.toISOString(),
      })
      .run();
  }
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.owner,
      title: 'Game',
      // The game's slug keys its daemon and prefixes its lifecycle labels.
      slug: 'castle-run',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: NOW.toISOString(),
    })
    .run();
  deps.db
    .insert(schema.jobs)
    .values({
      id: ids.job,
      gameId: ids.game,
      branchId: 'main',
      familyId: ids.family,
      creatorId: ids.owner,
      kind: 'feature',
      complexity: 2,
      state,
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify({
        title: 'Feature',
        summary: 'Build it',
        scope: { included: ['feature'], excluded: [] },
        tickets: [{ key: 'T1', skills: [], dependsOn: [], acceptanceCriteria: ['works'] }],
      }),
      reservation: '{"amountMicroUsd":4000000,"sizeClass":"medium","confidence":"low"}',
      hardCapMicroUsd: 4_000_000,
      aiurRepo: state === 'queued' ? null : 'owner/game',
      aiurIssueNumber: state === 'queued' ? null : 142,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.owner,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'owner@example.test',
    },
    {
      kind: 'user',
      userId: ids.other,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'other@example.test',
    },
  ]);
  return deps;
}

function appWith(
  deps: ReturnType<typeof setup>,
  input: {
    client?: Partial<AiurClient> | null;
    issues?: IssueStateWriter;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const app = createApp(deps);
  const issues = input.issues ?? { setStateLabel: vi.fn().mockResolvedValue(undefined) };
  app.route(
    '/api/v1/jobs',
    createControlsRoutes({
      daemonFor: async () => (input.client === null ? null : (input.client as AiurClient)),
      issues: () => issues,
      sleep: input.sleep ?? (async () => undefined),
      now: () => NOW,
    }),
  );
  return { app, issues };
}

const post = (app: ReturnType<typeof createApp>, path: string, userId = ids.owner, body?: unknown) =>
  app.request(`/api/v1/jobs/${ids.job}/${path}`, {
    method: 'POST',
    headers: { ...asUser(userId), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('job controls', () => {
  it('authorizes before making an aiur call', async () => {
    const deps = setup();
    const cancel = vi.fn();
    const { app } = appWith(deps, { client: { cancel } });

    const response = await post(app, 'cancel', ids.other);

    expect(response.status).toBe(403);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('confirms process exit before cancelling', async () => {
    const deps = setup();
    const cancel = vi.fn().mockResolvedValue({ process: { status: 'exited' } });
    const { app } = appWith(deps, { client: { cancel } });

    const first = await post(app, 'cancel');
    const second = await post(app, 'cancel');

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ state: 'cancelled', stage: 'cancelled', stageText: 'Stopped' });
    expect(second.status).toBe(200);
    expect(cancel).toHaveBeenCalledOnce();
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
  });

  it('returns 503 after three unconfirmed cancellations and leaves the job running', async () => {
    const deps = setup();
    const cancel = vi.fn().mockResolvedValue({ process: { status: 'still_running' } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: { cancel }, sleep });

    const response = await post(app, 'cancel');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'cancel_unconfirmed', details: { status: 'still_running' } });
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('running');
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'admin-alert', code: 'cancel_unconfirmed', jobId: ids.job }),
    );
  });

  it('retries a thrown 409 still_running/kill_failed and cancels once the process exits', async () => {
    const deps = setup();
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new AiurHttpError(409, 'still_running', 'busy', 'http://127.0.0.1:4101'))
      .mockRejectedValueOnce(new AiurHttpError(409, 'kill_failed', 'busy', 'http://127.0.0.1:4101'))
      .mockResolvedValue({ process: { status: 'exited' } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: { cancel }, sleep });

    const response = await post(app, 'cancel');

    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
  });

  it('returns 503 when a cancel keeps throwing 409 kill_failed three times', async () => {
    const deps = setup();
    const cancel = vi.fn().mockRejectedValue(new AiurHttpError(409, 'kill_failed', 'busy', 'http://127.0.0.1:4101'));
    const { app } = appWith(deps, { client: { cancel } });

    const response = await post(app, 'cancel');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'cancel_unconfirmed', details: { status: 'kill_failed' } });
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('running');
  });

  it('falls back to the cancelled state label when aiur has no running process', async () => {
    const deps = setup('filed');
    const cancel = vi
      .fn()
      .mockRejectedValue(new AiurHttpError(409, 'agent_not_running', 'not running', 'http://127.0.0.1:4101'));
    const setStateLabel = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: { cancel }, issues: { setStateLabel } });

    const response = await post(app, 'cancel');

    expect(response.status).toBe(200);
    expect(setStateLabel).toHaveBeenCalledWith('owner/game', 142, 'cancelled', 'castle-run');
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
  });

  it('uses the label fallback when the daemon is absent', async () => {
    const deps = setup('filed');
    const setStateLabel = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: null, issues: { setStateLabel } });

    expect((await post(app, 'cancel')).status).toBe(200);
    expect(setStateLabel).toHaveBeenCalledWith('owner/game', 142, 'cancelled', 'castle-run');
  });

  it('falls back to the agent prefix for a game saved before slugs existed', async () => {
    const deps = setup('filed');
    deps.db.update(schema.games).set({ slug: null }).where(eq(schema.games.id, ids.game)).run();
    const setStateLabel = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: null, issues: { setStateLabel } });

    expect((await post(app, 'cancel')).status).toBe(200);
    expect(setStateLabel).toHaveBeenCalledWith('owner/game', 142, 'cancelled', 'agent');
  });

  it('alerts and leaves the job active when the label fallback fails', async () => {
    const deps = setup('filed');
    const setStateLabel = vi.fn().mockRejectedValue(new Error('github unavailable'));
    const { app } = appWith(deps, { client: null, issues: { setStateLabel } });

    const response = await post(app, 'cancel');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'cancel_fallback_failed' });
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('filed');
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'admin-alert', code: 'cancel_fallback_failed', jobId: ids.job }),
    );
  });

  it('maps daemon HTTP failures without exposing upstream details', async () => {
    const deps = setup();
    const pause = vi
      .fn()
      .mockRejectedValue(new AiurHttpError(503, 'internal_secret_code', 'secret detail', 'http://127.0.0.1:4101'));
    const { app } = appWith(deps, { client: { pause } });

    const response = await post(app, 'pause');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'daemon_unavailable' });
  });

  it('forwards message ids and pause/resume controls', async () => {
    const deps = setup();
    const message = vi.fn().mockResolvedValue({ request_id: 'request-1' });
    const pause = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: { message, pause, resume } });

    const sent = await post(app, 'message', ids.owner, { text: 'Please try blue', messageId: 'm_123' });
    const paused = await post(app, 'pause');

    expect(sent.status).toBe(202);
    expect(await sent.json()).toEqual({ request_id: 'request-1' });
    expect(message).toHaveBeenCalledWith('142', 'Please try blue', 'm_123');
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ stage: 'paused', stageText: 'Paused' });
    expect(deps.db.select().from(schema.jobs).get()?.pausedReason).toBe('admin');

    const resumed = await post(app, 'resume');

    expect(resumed.status).toBe(200);
    expect(deps.db.select().from(schema.jobs).get()?.pausedReason).toBeNull();
    expect(pause).toHaveBeenCalledWith('142');
    expect(resume).toHaveBeenCalledWith('142');
  });

  it('answers an open command idempotently and marks it answered', async () => {
    const deps = setup();
    deps.db
      .insert(schema.commands)
      .values({
        decisionId: 'decision-1',
        jobId: ids.job,
        daemonSlug: 'owner-game',
        version: 3,
        question: 'Ship it?',
        options: '[]',
        status: 'open',
        openedAt: NOW.toISOString(),
      })
      .run();
    const decide = vi.fn().mockResolvedValue({ decision_id: 'decision-1' });
    const { app } = appWith(deps, { client: { decide } });

    const response = await post(app, 'decide', ids.owner, { commandId: 'decision-1', option: 'ship' });

    expect(response.status).toBe(200);
    expect(decide).toHaveBeenCalledWith(
      'decision-1',
      expect.objectContaining({ option: 'ship', expected_version: 3, idempotency_key: 'decision-1:3' }),
    );
    expect(
      deps.db.select().from(schema.commands).where(eq(schema.commands.decisionId, 'decision-1')).get(),
    ).toMatchObject({ status: 'answered', answeredAt: NOW.toISOString() });
  });

  it('reports a missing supervisor token without changing the command', async () => {
    const deps = setup();
    deps.db
      .insert(schema.commands)
      .values({
        decisionId: 'decision-1',
        jobId: ids.job,
        daemonSlug: 'owner-game',
        version: 1,
        question: 'Ship it?',
        options: '[]',
        status: 'open',
        openedAt: NOW.toISOString(),
      })
      .run();
    const decide = vi.fn().mockRejectedValue(new AiurConfigError('supervisor token missing'));
    const { app } = appWith(deps, { client: { decide } });

    const response = await post(app, 'decide', ids.owner, { commandId: 'decision-1', option: 'ship' });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'commands_unavailable' });
    expect(deps.db.select().from(schema.commands).get()?.status).toBe('open');
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'admin-alert', code: 'commands_unavailable', jobId: ids.job }),
    );
  });
});
