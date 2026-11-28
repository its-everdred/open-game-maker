import { AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import { migrate, openDb, schema, type Db } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { OutcomeUnknownError, type IssuesClient } from '../../src/github/issues.js';
import { createIntake } from '../../src/intake/file-job.js';

const NOW = new Date('2026-11-01T18:00:00.000Z');

function plan(twoTickets = false) {
  return {
    title: 'Goblin camp',
    summary: 'Add the camp without including a transcript.',
    scope: { included: ['camp'], excluded: ['wall jump'] },
    tickets: [
      { key: 'T1', skills: ['gm-core'], dependsOn: [], acceptanceCriteria: ['loads'] },
      ...(twoTickets ? [{ key: 'T2', skills: ['gm-core'], dependsOn: ['T1'], acceptanceCriteria: ['saves'] }] : []),
    ],
  };
}

function seed(db: Db, twoTickets = false, kind: 'feature' | 'scope' = 'feature') {
  db.insert(schema.families)
    .values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: NOW.toISOString() })
    .run();
  db.insert(schema.games)
    .values({
      id: 'g_1',
      familyId: 'f_1',
      ownerId: 'u_1',
      title: 'Game',
      // The game's slug keys its daemon and prefixes its lifecycle labels.
      slug: 'castle-run',
      visibility: 'private',
      githubOwner: 'owner',
      githubRepo: 'game',
      repoVisibility: 'private',
      repoUrl: 'https://github.com/owner/game',
      createdAt: NOW.toISOString(),
    })
    .run();
  db.insert(schema.jobs)
    .values({
      id: 'j_1',
      gameId: 'g_1',
      branchId: 'main',
      familyId: 'f_1',
      creatorId: 'u_1',
      kind,
      complexity: kind === 'scope' ? 1 : 3,
      state: 'admitted',
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify(
        kind === 'scope'
          ? {
              ...plan(false),
              tickets: [
                {
                  key: 'scope',
                  skills: ['gm-scope-options'],
                  dependsOn: [],
                  acceptanceCriteria: ['agree the scope'],
                },
              ],
            }
          : plan(twoTickets),
      ),
      reservation: JSON.stringify({ amountMicroUsd: 9_000_001, sizeClass: 'large', confidence: 'low' }),
      hardCapMicroUsd: 12_000_000,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run();
  if (kind === 'scope') {
    db.insert(schema.scopeSessions)
      .values({
        id: 's_88000000-0000-4000-8000-000000000001',
        gameId: 'g_1',
        creatorId: 'u_1',
        jobId: 'j_1',
        status: 'open',
        choices: JSON.stringify({
          genre: 'platformer',
          vibe: 'cozy',
          family: 'chunky-low-poly',
          world: 'floating islands',
          players: 'single',
          pov: 'isometric',
        }),
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      })
      .run();
  }
}

type Harness = ReturnType<typeof harness>;

function harness(twoTickets = false, kind: 'feature' | 'scope' = 'feature', prototypeShipped = true) {
  const { sqlite, db } = openDb(':memory:');
  migrate({ sqlite });
  seed(db, twoTickets, kind);
  const calls: string[] = [];
  let issueNumber = 0;
  const issues: IssuesClient = {
    hasPrototypeSkill: vi.fn().mockResolvedValue(true),
    ensureLabel: vi.fn(async (_repo, name) => {
      calls.push(`ensure:${name}`);
    }),
    findByMarkers: vi.fn(async () => null),
    create: vi.fn(async (_repo, issue) => {
      issueNumber += 1;
      calls.push(`create:${issueNumber}`);
      expect(issue.labels).toEqual(
        expect.arrayContaining([`complexity:${kind === 'scope' ? 1 : 3}`, 'feature:gm-j_1']),
      );
      return { number: issueNumber, url: `https://github.com/owner/game/issues/${issueNumber}` };
    }),
    labels: vi.fn(async () => ['complexity:3', 'feature:gm-j_1']),
    addLabel: vi.fn(async (_repo, number, label) => {
      calls.push(`label:${number}:${label}`);
    }),
    removeLabel: vi.fn(async () => undefined),
    setStateLabel: vi.fn(async () => undefined),
  };
  const aiur: Pick<AiurClient, 'setSpendCap' | 'nudgeTodo'> = {
    setSpendCap: vi.fn(async (id, usd) => {
      calls.push(`cap:${id}:${usd}`);
      return { amount: usd, currency: 'USD' };
    }),
    nudgeTodo: vi.fn(async (ids) => {
      calls.push(`nudge:${ids.join(',')}`);
    }),
  };
  const alerts: unknown[] = [];
  const failJob = vi.fn((jobId: string) => {
    db.update(schema.jobs)
      .set({ state: 'failed', terminalAt: NOW.toISOString(), updatedAt: NOW.toISOString() })
      .where(eq(schema.jobs.id, jobId))
      .run();
  });
  const fleet = {
    ensureDaemon: vi.fn(async () => ({
      status: 'running' as const,
      daemon: {
        slug: 'castle-run',
        repo: 'owner/game',
        checkoutPath: '/srv/ogm/owner-game',
        unit: 'ogm-aiur@owner-game.service',
        envFile: '/srv/ogm/owner-game.env',
        port: 4101,
        clientToken: 'token',
        status: 'running' as const,
      },
    })),
  };
  const aiurForGame = vi.fn<(daemonSlug: string) => Promise<typeof aiur>>(async () => aiur);
  const intake = createIntake({
    db,
    fleet,
    issues,
    aiurForGame,
    shippedSkills: ['gm-core', 'gm-verify', ...(prototypeShipped ? ['gm-prototype'] : [])],
    coreRepo: 'example/core',
    failJob,
    now: () => NOW,
    sleep: async () => undefined,
    alert: (event) => alerts.push(event),
  });
  return { sqlite, db, calls, issues, aiur, aiurForGame, fleet, intake, alerts, failJob };
}

function close(input: Harness) {
  input.intake.stop();
  input.sqlite.close();
}

describe('fileJob', () => {
  it('does not finalize filing if cancellation arrives during the nudge', async () => {
    const input = harness();
    vi.mocked(input.aiur.nudgeTodo).mockImplementation(async () => {
      input.db
        .update(schema.jobTickets)
        .set({ cancelRequestedAt: NOW.toISOString() })
        .where(eq(schema.jobTickets.jobId, 'j_1'))
        .run();
    });
    await input.intake.fileJob('j_1');
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('admitted');
    close(input);
  });
  it('does not pause a job when cancellation arrives before an exhausted-cap response', async () => {
    const input = harness();
    vi.mocked(input.aiur.setSpendCap).mockImplementation(async () => {
      input.db
        .update(schema.jobTickets)
        .set({ cancelRequestedAt: NOW.toISOString() })
        .where(eq(schema.jobTickets.jobId, 'j_1'))
        .run();
      throw new AiurHttpError(409, 'spend_cap_exhausted', 'spent', 'http://127.0.0.1');
    });
    await input.intake.fileJob('j_1');
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('admitted');
    close(input);
  });
  it('does not finish filing after cancellation is requested during the runnable-label write', async () => {
    const input = harness();
    vi.mocked(input.issues.addLabel).mockImplementation(async (_repo, _number, label) => {
      if (label === 'castle-run:todo') {
        input.db
          .update(schema.jobTickets)
          .set({ cancelRequestedAt: NOW.toISOString() })
          .where(eq(schema.jobTickets.jobId, 'j_1'))
          .run();
      }
    });

    await input.intake.fileJob('j_1');
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('admitted');
    expect(input.aiur.nudgeTodo).not.toHaveBeenCalled();
    close(input);
  });
  it('does not make a ticket runnable if cancellation arrives while reading its labels', async () => {
    const input = harness();
    vi.mocked(input.issues.labels).mockImplementation(async () => {
      input.db.update(schema.jobs).set({ state: 'cancelled' }).where(eq(schema.jobs.id, 'j_1')).run();
      return [];
    });

    await input.intake.fileJob('j_1');
    expect(input.calls).not.toContain('label:1:castle-run:todo');
    close(input);
  });

  it('does not make a ticket runnable if cancellation arrives while setting its spend cap', async () => {
    const input = harness();
    vi.mocked(input.aiur.setSpendCap).mockImplementation(async (_id, amount) => {
      input.db.update(schema.jobs).set({ state: 'cancelled' }).where(eq(schema.jobs.id, 'j_1')).run();
      return { amount, currency: 'USD' };
    });

    await input.intake.fileJob('j_1');
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
    expect(input.calls).not.toContain('label:1:castle-run:todo');
    close(input);
  });

  it('does not make a ticket runnable if the job was cancelled during issue creation', async () => {
    const input = harness();
    vi.mocked(input.issues.create).mockImplementation(async () => {
      input.db.update(schema.jobs).set({ state: 'cancelled' }).where(eq(schema.jobs.id, 'j_1')).run();
      return { number: 1, url: 'https://github.com/owner/game/issues/1' };
    });

    await input.intake.fileJob('j_1');
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('cancelled');
    expect(input.db.select().from(schema.jobTickets).get()?.terminalState).toBe('cancelled');
    expect(input.calls).not.toContain('label:1:castle-run:todo');
    close(input);
  });
  it('waits when the deployed skill pack has not been updated', async () => {
    const input = harness(false, 'feature', false);
    expect(await input.intake.fileJob('j_1')).toEqual({ deferred: 'aiur' });
    expect(input.issues.create).not.toHaveBeenCalled();
    close(input);
  });
  it('waits for the target game core to include gm-prototype before filing', async () => {
    const input = harness();
    vi.mocked(input.issues.hasPrototypeSkill).mockResolvedValue(false);
    expect(await input.intake.fileJob('j_1')).toEqual({ deferred: 'github' });
    expect(input.issues.create).not.toHaveBeenCalled();
    expect(input.fleet.ensureDaemon).not.toHaveBeenCalled();
    close(input);
  });
  it('defers repair filing until triage is ready, then files only the redacted triage ticket', async () => {
    const input = harness();
    input.db.update(schema.jobs).set({ kind: 'repair' }).where(eq(schema.jobs.id, 'j_1')).run();
    input.db
      .insert(schema.reports)
      .values({
        id: 'r_10000000-0000-4000-8000-000000000001',
        gameId: 'g_1',
        buildHash: 'a'.repeat(64),
        text: 'private creator words',
        signature: 'b'.repeat(64),
        route: 'game_repair',
        reproduction: 'crash_with_error',
        jobId: 'j_1',
        bundleKey: 'sha256:' + 'c'.repeat(64),
        reporterId: 'u_1',
        createdAt: NOW.toISOString(),
      })
      .run();

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'triage' });
    expect(input.fleet.ensureDaemon).not.toHaveBeenCalled();

    const body = [
      'Repair crash in draft (dddddddd)',
      '',
      '## Context',
      'Release: draft',
      `Signature: ${'d'.repeat(64)}`,
      'Reproduction: reproduces_with_error',
      'gm-report:r_10000000-0000-4000-8000-000000000001',
      'gm-job:j_1',
      '',
      '## Load skills',
      '- gm-repair',
      '- gm-verify',
      '',
      '## Acceptance',
      `- the promise test \`promises/${'d'.repeat(64)}.spec.ts\` passes; gm check and gm test green`,
    ].join('\n');
    input.db
      .update(schema.reports)
      .set({
        triageState: 'ready',
        triageSignature: 'd'.repeat(64),
        triageJson: JSON.stringify({
          status: 'triaged',
          result: {
            reportId: 'r_10000000-0000-4000-8000-000000000001',
            replay: {
              class: 'reproduces_with_error',
              durationMs: 15,
            },
            signature: 'd'.repeat(64),
            diagnosticsKey: 'sha256:' + 'e'.repeat(64),
            ticket: { title: 'Repair: crash in draft (dddddddd)', body, labels: ['kind:repair'] },
            promise: {
              specPath: `promises/${'d'.repeat(64)}.spec.ts`,
              replayPath: `promises/${'d'.repeat(64)}.replay.json`,
            },
          },
        }),
      })
      .where(eq(schema.reports.jobId, 'j_1'))
      .run();

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1] });
    const issue = vi.mocked(input.issues.create).mock.calls[0]?.[1];
    expect(issue).toMatchObject({ title: 'Repair: crash in draft (dddddddd)' });
    expect(issue?.body).toContain('gm-report:r_10000000-0000-4000-8000-000000000001');
    expect(issue?.body.match(/<!-- gm-job:/g)).toHaveLength(1);
    expect(issue?.body).toContain('gm-ticket:repair');
    expect(issue?.body).not.toContain('private creator words');
    close(input);
  });

  it('files a scope ticket with its session marker before making it runnable', async () => {
    const input = harness(false, 'scope');

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1] });

    const issue = vi.mocked(input.issues.create).mock.calls[0]?.[1];
    expect(issue?.body).toContain('gm-ticket:scope');
    expect(issue?.body).toContain('gm-scope:s_88000000-0000-4000-8000-000000000001');
    expect(issue?.body).toContain('## Load skills\n- gm-scope-options');
    expect(input.calls).toEqual([
      'ensure:feature:gm-j_1',
      'ensure:castle-run:todo',
      'ensure:slot:creator',
      'ensure:priority:1',
      'create:1',
      'cap:1:9.000001',
      'label:1:slot:creator',
      'label:1:priority:1',
      'label:1:castle-run:todo',
      'nudge:1',
    ]);
    expect(input.db.select().from(schema.scopeSessions).get()?.ticket).toBe('1');
    // The daemon is keyed by the game's slug, not its repository: two games in one instance repo get their own daemon.
    expect(input.fleet.ensureDaemon).toHaveBeenCalledWith({ slug: 'castle-run', repo: 'owner/game' }, 'feature');
    close(input);
  });

  it('files every ticket with spend caps before todo, then nudges once and marks the job filed', async () => {
    const input = harness(true);

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1, 2] });

    expect(input.calls).toEqual([
      'ensure:feature:gm-j_1',
      'ensure:castle-run:todo',
      'ensure:slot:creator',
      'ensure:priority:1',
      'ensure:phase:mock',
      'ensure:model:low',
      'create:1',
      'create:2',
      'cap:1:9.000001',
      'label:1:slot:creator',
      'label:1:priority:1',
      'label:1:castle-run:todo',
      'cap:2:9.000001',
      'label:2:slot:creator',
      'label:2:priority:1',
      'label:2:castle-run:todo',
      'nudge:1,2',
    ]);
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()).toMatchObject({
      state: 'filed',
      aiurRepo: 'owner/game',
      aiurIssueNumber: 1,
      aiurSpendCapMicroUsd: 9_000_001,
    });
    expect(input.db.select().from(schema.jobTickets).all()).toHaveLength(2);
    for (const [, issue] of input.issues.create.mock.calls)
      expect(issue.labels).toEqual(expect.arrayContaining(['phase:mock', 'model:low']));

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ skipped: 'state:filed' });
    expect(input.issues.create).toHaveBeenCalledTimes(2);
    close(input);
  });

  // #1270: Dusk Helm shares the open-games daemon (`blobs`), which reads `agent:` labels. A `dusk-helm:todo` ticket
  // would sit unworked, and the cap and nudge must reach the daemon that will work it.
  it('files a game that shares a registered daemon with that daemon’s label prefix and client', async () => {
    const input = harness();
    const running = await input.fleet.ensureDaemon();
    input.fleet.ensureDaemon.mockResolvedValue({
      ...running,
      daemon: { ...running.daemon, slug: 'blobs' },
      labelPrefix: 'agent',
    });

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1] });

    expect(input.calls).toContain('label:1:agent:todo');
    expect(input.calls.filter((call) => call.includes('castle-run:todo'))).toEqual([]);
    expect(input.aiurForGame).toHaveBeenCalledWith('blobs');
    close(input);
  });

  it('resumes from a durable issue row with cap, todo, and nudge only', async () => {
    const input = harness();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_1', key: 'T1', issueNumber: 7, repo: 'owner/game', sig: 'sig' })
      .run();

    await input.intake.fileJob('j_1');

    expect(input.issues.create).not.toHaveBeenCalled();
    expect(input.calls).toEqual([
      'ensure:feature:gm-j_1',
      'ensure:castle-run:todo',
      'ensure:slot:creator',
      'ensure:priority:1',
      'ensure:phase:mock',
      'ensure:model:low',
      'cap:7:9.000001',
      'label:7:slot:creator',
      'label:7:priority:1',
      'label:7:castle-run:todo',
      'nudge:7',
    ]);
    expect(input.db.select().from(schema.jobTickets).get()).toMatchObject({
      issueNumber: 7,
      capSetAt: NOW.toISOString(),
      todoAt: NOW.toISOString(),
      filedAt: NOW.toISOString(),
    });
    close(input);
  });

  it('labels recovered creator tickets for the reserved lane before making them runnable', async () => {
    const input = harness();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_1', key: 'T1', issueNumber: 7, repo: 'owner/game', sig: 'sig' })
      .run();
    await input.intake.fileJob('j_1');
    expect(input.calls).toContain('ensure:slot:creator');
    expect(input.calls).toContain('ensure:priority:1');
    expect(input.calls.indexOf('label:7:slot:creator')).toBeLessThan(input.calls.indexOf('label:7:castle-run:todo'));
    expect(input.calls.indexOf('label:7:priority:1')).toBeLessThan(input.calls.indexOf('label:7:castle-run:todo'));
    expect(input.calls).toContain('label:7:slot:creator');
    expect(input.calls).toContain('label:7:priority:1');
    close(input);
  });

  it('reconciles an outcome-unknown create by marker before continuing', async () => {
    const input = harness();
    vi.mocked(input.issues.findByMarkers)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ number: 12, url: 'https://github.com/owner/game/issues/12', labels: [] });
    vi.mocked(input.issues.create).mockRejectedValueOnce(new OutcomeUnknownError('owner/game', 'j_1', 'T1'));

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [12] });
    expect(input.calls).toEqual([
      'ensure:feature:gm-j_1',
      'ensure:castle-run:todo',
      'ensure:slot:creator',
      'ensure:priority:1',
      'ensure:phase:mock',
      'ensure:model:low',
      'cap:12:9.000001',
      'label:12:slot:creator',
      'label:12:priority:1',
      'label:12:castle-run:todo',
      'nudge:12',
    ]);
    close(input);
  });

  it('leaves the job admitted when the daemon has not observed the new ticket after three cap attempts', async () => {
    const input = harness();
    vi.mocked(input.aiur.setSpendCap).mockRejectedValue(
      new AiurHttpError(404, 'ticket_not_found', 'not found', 'http://127.0.0.1:4101'),
    );

    await input.intake.fileJob('j_1');

    expect(input.aiur.setSpendCap).toHaveBeenCalledTimes(3);
    expect(input.issues.addLabel).not.toHaveBeenCalled();
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('admitted');
    expect(input.alerts).toEqual([expect.objectContaining({ code: 'spend_cap_failed', jobId: 'j_1' })]);
    close(input);
  });

  it('pauses the job when a reused ticket has exhausted its spend cap', async () => {
    const input = harness();
    vi.mocked(input.aiur.setSpendCap).mockRejectedValueOnce(
      new AiurHttpError(409, 'spend_cap_exhausted', 'spent', 'http://127.0.0.1:4101'),
    );

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'aiur' });

    expect(input.issues.addLabel).not.toHaveBeenCalled();
    expect(input.db.select().from(schema.jobs).get()).toMatchObject({
      state: 'paused_budget',
      pausedReason: 'budget_exhausted',
    });
    close(input);
  });

  it('recovers an admitted job older than the sweep threshold', async () => {
    const input = harness();
    input.db.update(schema.jobs).set({ updatedAt: '2026-11-01T17:58:59.000Z' }).where(eq(schema.jobs.id, 'j_1')).run();

    await input.intake.sweep();

    expect(input.db.select().from(schema.jobs).get()?.state).toBe('filed');
    expect(input.calls).toContain('nudge:1');
    close(input);
  });

  it('files nothing while waiting for capacity', async () => {
    const input = harness();
    input.fleet.ensureDaemon.mockResolvedValueOnce({ status: 'waiting_capacity', live: 4 });

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'capacity' });
    expect(input.issues.ensureLabel).not.toHaveBeenCalled();
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('admitted');
    close(input);
  });

  it('marks a stopped preflight failed with its reasons and files nothing', async () => {
    const input = harness();
    input.fleet.ensureDaemon.mockResolvedValueOnce({
      status: 'stopped',
      reasons: ['config drift: tracker.github.allowed_users'],
    });

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({
      failed: 'preflight',
      reasons: ['config drift: tracker.github.allowed_users'],
    });
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('failed');
    expect(input.failJob).toHaveBeenCalledWith('j_1');
    expect(input.issues.ensureLabel).not.toHaveBeenCalled();
    expect(input.alerts).toEqual([
      expect.objectContaining({ code: 'preflight_failed', reasons: ['config drift: tracker.github.allowed_users'] }),
    ]);
    close(input);
  });

  it('retains the slot when preflight fails after a ticket was recorded', async () => {
    const input = harness();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_1', key: 'T1', issueNumber: 1, repo: 'owner/game', sig: 'sig' })
      .run();
    input.fleet.ensureDaemon.mockResolvedValueOnce({ status: 'stopped', reasons: ['daemon unavailable'] });

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'aiur' });
    expect(input.failJob).not.toHaveBeenCalled();
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('admitted');
    close(input);
  });

  it('marks the job filed when the best-effort nudge fails', async () => {
    const input = harness();
    vi.mocked(input.aiur.nudgeTodo).mockRejectedValueOnce(new Error('offline'));

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1] });
    expect(input.db.select().from(schema.jobs).get()?.state).toBe('filed');
    expect(input.alerts).toEqual([expect.objectContaining({ code: 'nudge_failed', jobId: 'j_1' })]);
    close(input);
  });
});
