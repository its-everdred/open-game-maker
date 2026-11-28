import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiurConfigError, AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import { withJobDispatchLock } from '@ogm/builder';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app/app.js';
import { HttpError } from '../../src/app/errors.js';
import type { IssueStateWriter } from '../../src/app/registry.js';
import { createControlsRoutes } from '../../src/jobs/controls.js';
import { markRunning, markTerminal } from '../../src/jobs/spend-cap.js';
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
    daemonFor?: () => Promise<AiurClient | null>;
    issues?: IssueStateWriter;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const app = createApp(deps);
  const issues = input.issues ?? { setStateLabel: vi.fn().mockResolvedValue(undefined) };
  app.route(
    '/api/v1/jobs',
    createControlsRoutes({
      daemonFor: input.daemonFor ?? (async () => (input.client === null ? null : (input.client as AiurClient))),
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
  it('accepts a staged child worker event before the filed checkpoint', () => {
    const deps = setup('queued');
    deps.db
      .update(schema.jobs)
      .set({
        state: 'admitted',
        idempotencyKey: 'planner:j_parent:starter',
        aiurIssueNumber: 42,
        aiurRepo: 'owner/game',
      })
      .where(eq(schema.jobs.id, ids.job))
      .run();
    const lifecycle = {
      db: deps.db,
      sqlite: deps.sqlite,
      events: deps.events,
      defaults: {
        dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
        defaultAllowanceConfigured: deps.config.defaultDailyAllowanceConfigured,
        resetZone: deps.config.resetZoneDefault,
      },
      now: () => NOW,
    };
    markRunning(lifecycle, ids.job);
    expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, ids.job)).get()?.state).toBe('running');
  });
  it('recovers an uncertain child create in the parent planner repository', async () => {
    const deps = setup('queued');
    const child = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, ids.job)).get()!;
    deps.db
      .insert(schema.jobs)
      .values({ ...child, id: 'j_parent', kind: 'new_game', idempotencyKey: null })
      .run();
    deps.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_parent', key: 'new-game-plan', issueNumber: 41, repo: 'old/game', sig: 'sig' })
      .run();
    deps.db
      .update(schema.jobs)
      .set({ idempotencyKey: 'planner:j_parent:starter' })
      .where(eq(schema.jobs.id, ids.job))
      .run();
    deps.db
      .update(schema.games)
      .set({ githubOwner: 'new', githubRepo: 'game' })
      .where(eq(schema.games.id, ids.game))
      .run();
    const findByMarkers = vi.fn().mockResolvedValue({ number: 142 });
    const close = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: null, issues: { findByMarkers, close, setStateLabel: vi.fn() } });
    expect((await post(app, 'cancel')).status).toBe(200);
    expect(findByMarkers).toHaveBeenCalledWith('old/game', ids.job, 'T1');
    expect(close).toHaveBeenCalledWith('old/game', 142);
  });
  it('closes a child recorded before its spend cap when cancelled', async () => {
    const deps = setup('queued');
    deps.db
      .update(schema.jobs)
      .set({ idempotencyKey: 'planner:j_parent:starter' })
      .where(eq(schema.jobs.id, ids.job))
      .run();
    deps.db
      .insert(schema.jobTickets)
      .values({ jobId: ids.job, key: 'T1', issueNumber: 142, repo: 'old/game', sig: 'sig' })
      .run();
    const close = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: null, issues: { close, setStateLabel: vi.fn() } });
    expect((await post(app, 'cancel')).status).toBe(200);
    expect(close).toHaveBeenCalledWith('old/game', 142);
    expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, ids.job)).get()).toMatchObject({
      state: 'cancelled',
      releasedAt: expect.any(String),
    });
  });
  it('refuses to claim a planner cancellation when its daemon prefix cannot be determined', async () => {
    const deps = setup('filed');
    deps.db.update(schema.jobs).set({ kind: 'new_game' }).where(eq(schema.jobs.id, ids.job)).run();
    const setStateLabel = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: null, issues: { setStateLabel } });
    expect((await post(app, 'cancel')).status).toBe(503);
    expect(setStateLabel).not.toHaveBeenCalled();
    expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, ids.job)).get()?.state).toBe('filed');
  });
  it('falls back to issue labels when daemon credentials are unavailable', async () => {
    const deps = setup('filed');
    const setStateLabel = vi.fn().mockResolvedValue(undefined);
    const daemonFor = vi.fn().mockRejectedValue(new HttpError(503, 'daemon_credentials_unavailable'));
    const { app } = appWith(deps, { daemonFor, issues: { setStateLabel } });
    expect((await post(app, 'cancel')).status).toBe(200);
    expect(setStateLabel).toHaveBeenCalledOnce();
  });
  it('releases a queued child reservation on permanent preflight failure', () => {
    const deps = setup('queued');
    markTerminal(
      {
        db: deps.db,
        sqlite: deps.sqlite,
        events: deps.events,
        defaults: {
          dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
          defaultAllowanceConfigured: deps.config.defaultDailyAllowanceConfigured,
          resetZone: deps.config.resetZoneDefault,
        },
        now: () => NOW,
      },
      ids.job,
      'failed',
    );
    const row = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, ids.job)).get()!;
    expect(row.state).toBe('failed');
    expect(row.releasedAt).not.toBeNull();
  });
  it('uses the shared daemon dispatch prefix when cancelling a waiting ticket', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogm-daemon-prefix-'));
    try {
      mkdirSync(join(root, '.aiur'));
      writeFileSync(join(root, '.aiur/config'), 'tracker:\n  github:\n    label_prefix: shared\n');
      const deps = setup('filed');
      deps.db
        .update(schema.games)
        .set({ githubOwner: 'owner', githubRepo: 'game' })
        .where(eq(schema.games.id, ids.game))
        .run();
      deps.db
        .insert(schema.gameDaemons)
        .values({
          slug: 'other-game',
          port: 12345,
          repo: 'owner/game',
          checkoutPath: root,
          unit: 'fixture',
          envFile: '/fixture',
          status: 'running',
          createdAt: NOW.toISOString(),
        })
        .run();
      const setStateLabel = vi.fn().mockResolvedValue(undefined);
      const { app } = appWith(deps, { client: null, issues: { setStateLabel } });
      expect((await post(app, 'cancel')).status).toBe(200);
      expect(setStateLabel).toHaveBeenCalledWith('owner/game', 142, 'cancelled', 'shared');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('cancels a staged queued child without deferring its reservation release', async () => {
    const deps = setup('queued');
    deps.db
      .update(schema.jobs)
      .set({ aiurRepo: 'owner/game', aiurIssueNumber: 142, idempotencyKey: 'planner:j_parent:starter' })
      .where(eq(schema.jobs.id, ids.job))
      .run();
    const cancel = vi.fn();
    const daemonFor = vi.fn().mockRejectedValue(new HttpError(503, 'daemon_credentials_unavailable'));
    const setStateLabel = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const { app } = appWith(deps, { client: { cancel }, daemonFor, issues: { setStateLabel, close } });
    expect((await post(app, 'cancel')).status).toBe(200);
    const row = deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, ids.job)).get()!;
    expect(row.state).toBe('cancelled');
    expect(row.releasedAt).not.toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    expect(daemonFor).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith('owner/game', 142);
    expect(setStateLabel).not.toHaveBeenCalled();
  });
  it('waits for in-flight dispatch before cancelling its planner ticket', async () => {
    const deps = setup('queued');
    deps.db.update(schema.jobs).set({ state: 'admitted' }).where(eq(schema.jobs.id, ids.job)).run();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const dispatch = withJobDispatchLock(ids.job, async () => {
      entered();
      await gate;
      deps.db
        .update(schema.jobs)
        .set({ state: 'filed', aiurRepo: 'owner/game', aiurIssueNumber: 99 })
        .where(eq(schema.jobs.id, ids.job))
        .run();
    });
    await started;
    const cancel = vi.fn().mockResolvedValue({ process: { status: 'exited' } });
    const { app } = appWith(deps, { client: { cancel } });
    const response = post(app, 'cancel');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cancel).not.toHaveBeenCalled();
    release();
    await dispatch;
    expect((await response).status).toBe(200);
    expect(cancel).toHaveBeenCalledWith('99');
    expect(deps.db.select().from(schema.jobs).where(eq(schema.jobs.id, ids.job)).get()?.state).toBe('cancelled');
  });
  it('does not release an admitted job while its ticket is being filed', async () => {
    const deps = setup('queued');
    deps.db.update(schema.jobs).set({ state: 'admitted' }).run();
    deps.db
      .insert(schema.jobTickets)
      .values({
        jobId: ids.job,
        key: 'first',
        issueNumber: 142,
        repo: 'owner/game',
        sig: 'first',
        capSetAt: NOW.toISOString(),
      })
      .run();
    const { app } = appWith(deps);

    expect((await post(app, 'cancel')).status).toBe(409);
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({ state: 'admitted', releasedAt: null });
  });
  it('cancels a stalled filing before any ticket has a spend cap', async () => {
    const deps = setup('queued');
    deps.db.update(schema.jobs).set({ state: 'admitted' }).run();
    deps.db
      .insert(schema.jobTickets)
      .values({ jobId: ids.job, key: 'first', issueNumber: 142, repo: 'owner/game', sig: 'first' })
      .run();
    const { app } = appWith(deps);

    expect((await post(app, 'cancel')).status).toBe(200);
    expect(deps.db.select().from(schema.jobs).get()).toMatchObject({
      state: 'cancelled',
      releasedAt: expect.any(String),
    });
    expect(deps.db.select().from(schema.jobTickets).get()?.terminalState).toBe('cancelled');
  });
  it('does not cancel an admitted New Game request while its parent may be in flight', async () => {
    const deps = setup('queued');
    deps.db.update(schema.jobs).set({ state: 'admitted', kind: 'new_game' }).run();
    const { app } = appWith(deps);
    expect((await post(app, 'cancel')).status).toBe(409);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('admitted');
  });
  it('confirms every ticket before cancelling a multi-ticket job', async () => {
    const deps = setup();
    deps.db
      .insert(schema.jobTickets)
      .values([
        { jobId: ids.job, key: 'first', issueNumber: 142, repo: 'owner/game', sig: 'first' },
        { jobId: ids.job, key: 'second', issueNumber: 143, repo: 'owner/game', sig: 'second' },
      ])
      .run();
    const cancel = vi
      .fn()
      .mockResolvedValueOnce({ process: { status: 'exited' } })
      .mockResolvedValue({ process: { status: 'still_running' } });
    const { app } = appWith(deps, { client: { cancel } });

    expect((await post(app, 'cancel')).status).toBe(503);
    expect(cancel.mock.calls.map(([ticket]) => ticket)).toEqual(['142', '143', '143', '143']);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('running');
    cancel.mockReset().mockResolvedValue({ process: { status: 'exited' } });
    expect((await post(app, 'cancel')).status).toBe(200);
    expect(cancel.mock.calls.map(([ticket]) => ticket)).toEqual(['143']);
    expect(deps.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
  });
  it('keeps multi-ticket work active when the daemon is unavailable', async () => {
    const deps = setup();
    deps.db
      .insert(schema.jobTickets)
      .values([
        { jobId: ids.job, key: 'first', issueNumber: 142, repo: 'owner/game', sig: 'first' },
        { jobId: ids.job, key: 'second', issueNumber: 143, repo: 'owner/game', sig: 'second' },
      ])
      .run();
    const setStateLabel = vi.fn();
    const { app } = appWith(deps, { client: null, issues: { setStateLabel } });
    expect((await post(app, 'cancel')).status).toBe(503);
    expect(setStateLabel).not.toHaveBeenCalled();
    expect(
      deps.db
        .select()
        .from(schema.jobTickets)
        .all()
        .every((ticket) => ticket.terminalState === null),
    ).toBe(true);
  });
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
