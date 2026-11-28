import { AiurHttpError, type AiurClient } from '@ogm/aiur-client';
import { migrate, openDb, schema, type Db } from '@ogm/db';
import { isDaemonLabel } from '@ogm/game-repo-template';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import type { IssuesClient } from '../../src/github/issues.js';
import { createIntake } from '../../src/intake/file-job.js';
import { PARENT_LABEL, parentIssueFor } from '../../src/intake/parent.js';
import { renderAiurConfig } from '../../src/policy/render.js';

const NOW = new Date('2026-11-04T18:00:00.000Z');
const SESSION_ID = 's_88000000-0000-4000-8000-000000000042';

const CHOICES = {
  genre: 'platformer',
  vibe: 'cozy',
  family: 'chunky-low-poly',
  world: 'floating islands',
  players: 'single',
  pov: 'isometric',
  audio: { style: 'chiptune', mood: 'playful' },
};

const PLAN = {
  title: 'Lantern Bay',
  summary: 'A cozy island platformer where the player relights harbour lanterns at dusk.',
  scope: { included: ['lanterns'], excluded: ['multiplayer'] },
  tickets: [{ key: 'T1', skills: ['gm-core'], dependsOn: [], acceptanceCriteria: ['the lighthouse lights up'] }],
};

function seed(db: Db, kind: 'new_game' | 'feature' = 'new_game') {
  db.insert(schema.families)
    .values({ id: 'f_1', name: 'Family', ownerUserId: 'u_1', createdAt: NOW.toISOString() })
    .run();
  db.insert(schema.games)
    .values({
      id: 'g_1',
      familyId: 'f_1',
      ownerId: 'u_1',
      title: 'Lantern Bay',
      slug: 'lantern-bay',
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
      complexity: kind === 'new_game' ? 3 : 2,
      state: 'admitted',
      start: 'now',
      slot: kind === 'new_game' ? 'new_game' : 'edit',
      plan: JSON.stringify(PLAN),
      reservation: JSON.stringify({ amountMicroUsd: 9_000_001, sizeClass: 'large', confidence: 'low' }),
      hardCapMicroUsd: 12_000_000,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run();
  // The scope chat's own job; the New Game request job above is what the parent issue belongs to.
  db.insert(schema.jobs)
    .values({
      id: 'j_scope',
      gameId: 'g_1',
      branchId: 'main',
      familyId: 'f_1',
      creatorId: 'u_1',
      kind: 'scope',
      complexity: 1,
      state: 'filed',
      start: 'now',
      slot: 'edit',
      plan: JSON.stringify(PLAN),
      reservation: JSON.stringify({ amountMicroUsd: 1_000_000, sizeClass: 'small', confidence: 'low' }),
      hardCapMicroUsd: 1_000_000,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run();
  db.insert(schema.scopeSessions)
    .values({
      id: SESSION_ID,
      gameId: 'g_1',
      creatorId: 'u_1',
      jobId: 'j_scope',
      status: 'agreed',
      revision: 1,
      choices: JSON.stringify(CHOICES),
      scope: JSON.stringify({
        session_id: SESSION_ID,
        revision: 1,
        title: PLAN.title,
        summary: PLAN.summary,
        scope: PLAN.scope,
        tickets: PLAN.tickets.map((ticket) => ({ ...ticket, title: ticket.key })),
        complexity: 3,
        open_questions: [],
        ideas: [],
      }),
      scopeHash: 'a'.repeat(64),
      createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
      updatedAt: NOW.toISOString(),
    })
    .run();
}

function harness(kind: 'new_game' | 'feature' = 'new_game', plannerShipped = true) {
  const { sqlite, db } = openDb(':memory:');
  migrate({ sqlite });
  seed(db, kind);
  const calls: string[] = [];
  let issueNumber = 0;
  const created: { title: string; body: string; labels: string[] }[] = [];
  const issues: IssuesClient = {
    hasPrototypeSkill: vi.fn().mockResolvedValue(true),
    ensureLabel: vi.fn(async (_repo, name) => {
      calls.push(`ensure:${name}`);
    }),
    findByMarkers: vi.fn(async () => null),
    create: vi.fn(async (_repo, issue) => {
      issueNumber += 1;
      calls.push(`create:${issueNumber}`);
      created.push(issue);
      return { number: issueNumber, url: `https://github.com/owner/game/issues/${issueNumber}` };
    }),
    labels: vi.fn(async () => []),
    addLabel: vi.fn(async (_repo, number, label) => {
      calls.push(`label:${number}:${label}`);
    }),
    removeLabel: vi.fn(async () => undefined),
    blockBy: vi.fn(async (_repo, number, parent) => {
      calls.push(`block:${number}:${parent}`);
    }),
    unblockBy: vi.fn(async (_repo, number, parent) => {
      calls.push(`unblock:${number}:${parent}`);
    }),
    close: vi.fn(async () => undefined),
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
        slug: 'lantern-bay',
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
  const intake = createIntake({
    db,
    fleet,
    issues,
    aiurForGame: async () => aiur,
    shippedSkills: ['gm-core', 'gm-verify', 'gm-prototype', ...(plannerShipped ? ['gm-new-game-plan'] : [])],
    coreRepo: 'example/core',
    failJob,
    now: () => NOW,
    sleep: async () => undefined,
    alert: (event) => alerts.push(event),
  });
  return { sqlite, db, calls, issues, aiur, fleet, intake, alerts, failJob, created };
}

function close(input: ReturnType<typeof harness>) {
  input.intake.stop();
  input.sqlite.close();
}

describe('New Game parent issue', () => {
  it('does not dispatch a planner when its skill has not shipped', async () => {
    const input = harness('new_game', false);
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'aiur' });
    expect(input.issues.create).not.toHaveBeenCalled();
    close(input);
  });

  it('is only a New Game request: an editor chat request never takes the parent path', () => {
    const { sqlite, db } = openDb(':memory:');
    migrate({ sqlite });
    seed(db, 'feature');
    const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    const game = db.select().from(schema.games).where(eq(schema.games.id, 'g_1')).get()!;

    expect(parentIssueFor(db, job, game)).toBeNull();
    sqlite.close();
  });

  it('carries creation choices and a short brief, and nothing raw from the scope conversation', () => {
    const input = harness();
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    const game = input.db.select().from(schema.games).where(eq(schema.games.id, 'g_1')).get()!;

    const parent = parentIssueFor(input.db, job, game);

    expect(parent).toMatchObject({ title: 'Lantern Bay', reference: 'j_1', labels: [PARENT_LABEL, 'feature:gm-j_1'] });
    expect(parent?.body).toContain('## Creation choices');
    expect(parent?.body).toContain('- Genre: platformer');
    expect(parent?.body).toContain('- World: floating islands');
    expect(parent?.body).toContain('- Audio direction: chiptune, playful');
    expect(parent?.body).toContain(`Brief: ${PLAN.summary}`);
    expect(parent?.body).toContain('- Game: g_1');
    expect(parent?.body).toContain('- Private context reference: j_1');
    // The plan's tickets and scope lists stay in the private store; only the summary reaches GitHub.
    expect(parent?.body).not.toContain('the lighthouse lights up');
    expect(parent?.body).not.toContain('- included: lanterns');
    expect(parent?.body).not.toContain('gm-ticket:T1');
    close(input);
  });

  it('reads the finished form choices from a promoted game draft', () => {
    const input = harness();
    input.db.delete(schema.scopeSessions).where(eq(schema.scopeSessions.id, SESSION_ID)).run();
    input.db
      .insert(schema.gameDrafts)
      .values({
        id: 'd_88000000-0000-4000-8000-000000000042',
        familyId: 'f_1',
        creatorId: 'u_1',
        choices: JSON.stringify(CHOICES),
        allowAiGeneratedAssets: true,
        status: 'promoted',
        revision: 1,
        scope: JSON.stringify({ ...PLAN, session_id: 'd_88000000-0000-4000-8000-000000000042', revision: 1 }),
        scopeHash: 'hash',
        gameId: 'g_1',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
      })
      .run();
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    const game = input.db.select().from(schema.games).where(eq(schema.games.id, 'g_1')).get()!;

    expect(parentIssueFor(input.db, job, game)?.body).toContain('- Genre: platformer');
    close(input);
  });

  it('redacts an address-shaped value and truncates a long brief', () => {
    const input = harness();
    const long = `${'x'.repeat(500)} ask me at maker@example.test`;
    input.db
      .update(schema.jobs)
      .set({ plan: JSON.stringify({ ...PLAN, title: 'Lantern Bay for maker@example.test', summary: long }) })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    input.db
      .update(schema.scopeSessions)
      .set({ choices: JSON.stringify({ ...CHOICES, other: 'mail me at maker@example.test' }) })
      .where(eq(schema.scopeSessions.id, SESSION_ID))
      .run();
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    const game = input.db.select().from(schema.games).where(eq(schema.games.id, 'g_1')).get()!;

    const parent = parentIssueFor(input.db, job, game);

    expect(parent?.title).toBe('Lantern Bay for [redacted]');
    expect(parent?.body).not.toContain('maker@example.test');
    expect(parent?.body).toContain('[redacted]');
    expect(parent?.body.length).toBeLessThan(1_400);
    close(input);
  });

  it('files the parent and queues a capped planner while the request remains active', async () => {
    const input = harness();

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1, 2] });

    expect(input.created).toHaveLength(2);
    expect(input.created[0]?.labels).toEqual([PARENT_LABEL, 'feature:gm-j_1']);
    // Nothing a daemon dispatches on: not the game's `<slug>:todo`, not any lifecycle label.
    expect(input.created[0]?.labels.filter((label) => isDaemonLabel(label))).toEqual([]);
    expect(input.created[0]?.body).not.toContain('castle-run:todo');
    expect(input.created[1]?.body).toContain('request in #1');
    expect(
      JSON.parse(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!.plan)._plannerTicketLimit,
    ).toBe(1);
    expect(input.calls).toContain('cap:2:9.000001');
    expect(input.calls).toContain('label:2:lantern-bay:todo');
    expect(input.calls).toContain('nudge:2');
    expect(input.db.select().from(schema.jobTickets).where(eq(schema.jobTickets.key, 'new-game')).get()).toMatchObject({
      jobId: 'j_1',
      key: 'new-game',
      issueNumber: 1,
      repo: 'owner/game',
      todoAt: null,
      capSetAt: null,
    });
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()).toMatchObject({
      state: 'filed',
      aiurRepo: 'owner/game',
      aiurIssueNumber: 2,
    });

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ skipped: 'state:filed' });
    expect(input.issues.create).toHaveBeenCalledTimes(2);
    close(input);
  });

  // The daemon the intake starts for this game reads `<label_prefix>:<active_state>`; aiur only dispatches a ticket
  // whose state label carries that prefix. The parent's labels are read against the daemon's real rendered config, so
  // "a worker never claims it" is proven against the dispatch label set rather than a suffix list.
  it("carries no label the game's daemon reads as a dispatch state", () => {
    const input = harness();
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    const game = input.db.select().from(schema.games).where(eq(schema.games.id, 'g_1')).get()!;
    const parent = parentIssueFor(input.db, job, game)!;

    const config = parse(
      renderAiurConfig({
        repo: 'owner/game',
        labelPrefix: 'lantern-bay',
        workspaceRoot: '/srv/ogm/owner-game/workspaces',
        port: 4101,
        intakeLogin: 'intake',
        botAccount: 'builder',
        kind: 'new_game',
        maxConcurrentAgents: 1,
        denyReadRoots: [],
        instanceId: 'lantern-bay',
      }),
    ) as { tracker: { active_states: string[]; github: { label_prefix: string } } };

    const prefix = config.tracker.github.label_prefix;
    expect(prefix).toBe('lantern-bay');
    expect(parent.labels.some((label) => label.startsWith(`${prefix}:`))).toBe(false);
    const dispatch = config.tracker.active_states.map((state) => `${prefix}:${state}`);
    expect(parent.labels.filter((label) => dispatch.includes(label))).toEqual([]);
    close(input);
  });

  it('reuses the parent already recorded for the request instead of filing a second one', async () => {
    const input = harness();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_1', key: 'new-game', issueNumber: 7, repo: 'owner/game', sig: 'sig' })
      .run();

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [7, 1] });

    expect(input.issues.create).toHaveBeenCalledTimes(1);
    close(input);
  });

  it('recovers a create whose outcome was unknown by its marker', async () => {
    const input = harness();
    vi.mocked(input.issues.findByMarkers).mockResolvedValueOnce({
      number: 12,
      url: 'https://github.com/owner/game/issues/12',
      labels: [PARENT_LABEL],
    });

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [12, 1] });

    expect(input.issues.create).toHaveBeenCalledTimes(1);
    expect(input.db.select().from(schema.jobs).get()).toMatchObject({ aiurIssueNumber: 1, state: 'filed' });
    close(input);
  });

  it('leaves the request admitted when GitHub refuses the parent', async () => {
    const input = harness();
    vi.mocked(input.issues.create).mockRejectedValueOnce(new Error('offline'));

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'github' });

    expect(input.db.select().from(schema.jobs).get()).toMatchObject({ state: 'admitted', aiurIssueNumber: null });
    expect(input.alerts).toEqual([expect.objectContaining({ code: 'github_failed', jobId: 'j_1' })]);
    close(input);
  });

  it('resumes a planner after a todo-label failure without creating or capping it twice', async () => {
    const input = harness();
    vi.mocked(input.issues.addLabel).mockRejectedValueOnce(new Error('offline'));
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'github' });
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()?.state).toBe('filed');
    input.db
      .update(schema.jobs)
      .set({ updatedAt: new Date(NOW.getTime() - 120_000).toISOString() })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    await input.intake.sweep();
    expect(
      input.db.select().from(schema.jobTickets).where(eq(schema.jobTickets.key, 'new-game-plan')).get()?.todoAt,
    ).not.toBeNull();
    expect(input.issues.create).toHaveBeenCalledTimes(2);
    expect(input.aiur.setSpendCap).toHaveBeenCalledTimes(1);
    close(input);
  });

  it('does not dispatch if cancellation wins while the spend cap is being installed', async () => {
    const input = harness();
    vi.mocked(input.aiur.setSpendCap).mockImplementationOnce(async (_id, amount) => {
      input.db.update(schema.jobs).set({ state: 'cancelled' }).where(eq(schema.jobs.id, 'j_1')).run();
      return { amount, currency: 'USD' };
    });
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ skipped: 'state:cancelled' });
    expect(input.issues.addLabel).not.toHaveBeenCalled();
    expect(input.aiur.nudgeTodo).not.toHaveBeenCalled();
    close(input);
  });

  it('does not queue a planner if its spend cap cannot be installed', async () => {
    const input = harness();
    vi.mocked(input.aiur.setSpendCap).mockRejectedValueOnce(new Error('offline'));
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'aiur' });
    expect(input.issues.addLabel).not.toHaveBeenCalled();
    expect(input.aiur.nudgeTodo).not.toHaveBeenCalled();
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1, 2] });
    expect(input.issues.create).toHaveBeenCalledTimes(2);
    close(input);
  });

  it('keeps an ordinary editor ticket off the request label', async () => {
    const input = harness('feature');

    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1] });

    expect(input.created).toHaveLength(1);
    expect(input.created[0]?.labels).not.toContain(PARENT_LABEL);
    expect(input.created[0]?.labels.filter((label) => label === PARENT_LABEL)).toEqual([]);
    expect(input.calls).toEqual([
      'ensure:feature:gm-j_1',
      'ensure:lantern-bay:todo',
      'ensure:slot:creator',
      'ensure:priority:1',
      'ensure:phase:mock',
      'ensure:model:low',
      'create:1',
      'cap:1:9.000001',
      'label:1:slot:creator',
      'label:1:priority:1',
      'label:1:lantern-bay:todo',
      'nudge:1',
    ]);
    close(input);
  });

  it('files a planner child with its game, role, parent and decision references before dispatch', async () => {
    const input = harness('feature');
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    input.db
      .insert(schema.jobs)
      .values({ ...job, id: 'j_parent', kind: 'new_game', idempotencyKey: null })
      .run();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_parent', key: 'new-game', issueNumber: 42, repo: 'owner/game', sig: 'parent' })
      .run();
    input.db
      .update(schema.jobs)
      .set({
        idempotencyKey: 'planner:j_parent:starter',
        state: 'queued',
        plan: JSON.stringify({
          ...PLAN,
          tickets: [{ ...PLAN.tickets[0], skills: ['gm-core', 'role:gameplay', 'decision:D-01'] }],
        }),
      })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    vi.mocked(input.aiur.setSpendCap).mockRejectedValueOnce(
      new AiurHttpError(409, 'spend_cap_exhausted', 'spent', 'http://127.0.0.1:4101'),
    );
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'aiur' });
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()?.state).toBe('queued');
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1] });
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()).toMatchObject({
      state: 'queued',
      aiurIssueNumber: 1,
    });
    expect(input.calls).toContain('label:1:lantern-bay:todo');
    expect(input.calls.indexOf('cap:1:9.000001')).toBeLessThan(input.calls.indexOf('block:1:42'));
    expect(input.calls.indexOf('block:1:42')).toBeLessThan(input.calls.indexOf('label:1:lantern-bay:todo'));
    expect(input.calls).not.toContain('nudge:1');
    input.db.update(schema.games).set({ githubRepo: 'new-game' }).where(eq(schema.games.id, 'g_1')).run();
    // A cancellation projection can survive a restart before the parent job row is updated.
    input.db
      .insert(schema.jobProjections)
      .values({
        jobId: 'j_parent',
        daemonSlug: 'lantern-bay',
        ticket: '42',
        stage: 'working',
        stageText: 'Working',
        lifecycle: 'cancelled',
        updatedAt: NOW.toISOString(),
      })
      .run();
    vi.mocked(input.issues.close!).mockRejectedValueOnce(new Error('temporary GitHub failure'));
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'github' });
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()?.state).toBe('queued');
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ skipped: 'parent_terminal' });
    expect(input.issues.close).toHaveBeenCalledWith('owner/game', 1);
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()?.state).toBe('failed');
    close(input);
  });

  it('dispatches a staged child after it is admitted', async () => {
    const input = harness('feature');
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    input.db
      .insert(schema.jobs)
      .values({ ...job, id: 'j_parent', kind: 'new_game', idempotencyKey: null })
      .run();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_parent', key: 'new-game', issueNumber: 42, repo: 'owner/game', sig: 'parent' })
      .run();
    input.db
      .update(schema.jobs)
      .set({
        state: 'queued',
        idempotencyKey: 'planner:j_parent:starter',
        plan: JSON.stringify({
          ...PLAN,
          tickets: [{ ...PLAN.tickets[0], skills: ['gm-core', 'role:gameplay', 'decision:D-01'] }],
        }),
      })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    await input.intake.fileJob('j_1');
    input.db.update(schema.jobs).set({ state: 'admitted' }).where(eq(schema.jobs.id, 'j_1')).run();
    vi.mocked(input.aiur.nudgeTodo).mockImplementationOnce(async (ids) => {
      input.calls.push(`nudge:${ids.join(',')}`);
      input.db.update(schema.jobs).set({ state: 'running' }).where(eq(schema.jobs.id, 'j_1')).run();
    });
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ filed: true, issues: [1] });
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()?.state).toBe('running');
    expect(input.created).toHaveLength(1);
    expect(input.created[0]?.labels).toEqual(
      expect.arrayContaining(['game:lantern-bay', 'role:gameplay', 'priority:1']),
    );
    expect(input.created[0]?.body).toContain('Refs #42');
    expect(input.created[0]?.body).toContain('games/lantern-bay/docs/decisions.json');
    expect(input.created[0]?.body).toContain('## Creator decisions\n- D-01');
    expect(input.calls.indexOf('cap:1:9.000001')).toBeLessThan(input.calls.indexOf('label:1:lantern-bay:todo'));
    expect(input.calls).toContain('unblock:1:42');
    close(input);
  });
  it('keeps an admitted child recoverable when dispatch preflight fails', async () => {
    const input = harness('feature');
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    input.db
      .insert(schema.jobs)
      .values({ ...job, id: 'j_parent', kind: 'new_game', idempotencyKey: null })
      .run();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_1', key: 'T1', issueNumber: 7, repo: 'old/game', sig: 'child' })
      .run();
    input.db
      .update(schema.jobs)
      .set({ idempotencyKey: 'planner:j_parent:starter', aiurIssueNumber: 7 })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    input.db.update(schema.games).set({ slug: null }).where(eq(schema.games.id, 'g_1')).run();
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'aiur' });
    expect(input.issues.close).not.toHaveBeenCalled();
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()?.state).toBe('admitted');
    close(input);
  });

  it('closes an admitted child when its parent fails before dispatch', async () => {
    const input = harness('feature');
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    input.db
      .insert(schema.jobs)
      .values({ ...job, id: 'j_parent', kind: 'new_game', state: 'failed', idempotencyKey: null })
      .run();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_1', key: 'T1', issueNumber: 7, repo: 'owner/game', sig: 'child' })
      .run();
    input.db
      .update(schema.jobs)
      .set({ idempotencyKey: 'planner:j_parent:starter', aiurIssueNumber: 7 })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ skipped: 'parent_terminal' });
    expect(input.issues.close).toHaveBeenCalledWith('owner/game', 7);
    expect(input.calls).not.toContain('label:7:lantern-bay:todo');
    close(input);
  });

  it('keeps a staged child queued when preflight fails before its cap is set', async () => {
    const input = harness('feature');
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    input.db
      .insert(schema.jobs)
      .values({ ...job, id: 'j_parent', kind: 'new_game', idempotencyKey: null })
      .run();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_1', key: 'T1', issueNumber: 7, repo: 'owner/game', sig: 'child' })
      .run();
    input.db
      .update(schema.jobs)
      .set({ state: 'queued', idempotencyKey: 'planner:j_parent:starter' })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    input.db.update(schema.games).set({ slug: null }).where(eq(schema.games.id, 'g_1')).run();
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'aiur' });
    expect(input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()?.state).toBe('queued');
    expect(input.issues.close).not.toHaveBeenCalled();
    close(input);
  });

  it('does not file a child in a different repository from its planner', async () => {
    const input = harness('feature');
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    input.db
      .insert(schema.jobs)
      .values({ ...job, id: 'j_parent', kind: 'new_game', idempotencyKey: null })
      .run();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_parent', key: 'new-game', issueNumber: 42, repo: 'old/game', sig: 'parent' })
      .run();
    input.db
      .update(schema.jobs)
      .set({
        state: 'queued',
        idempotencyKey: 'planner:j_parent:starter',
        plan: JSON.stringify({ ...PLAN, tickets: [{ ...PLAN.tickets[0], skills: ['role:gameplay'] }] }),
      })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ deferred: 'github' });
    expect(input.issues.create).not.toHaveBeenCalled();
    close(input);
  });

  it('recovers a child create in the planner repository when game metadata changes', async () => {
    const input = harness('feature');
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    input.db
      .insert(schema.jobs)
      .values({ ...job, id: 'j_parent', kind: 'new_game', state: 'failed', idempotencyKey: null })
      .run();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_parent', key: 'new-game-plan', issueNumber: 42, repo: 'old/game', sig: 'parent' })
      .run();
    input.db
      .update(schema.jobs)
      .set({ state: 'queued', idempotencyKey: 'planner:j_parent:starter' })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    input.db
      .update(schema.games)
      .set({ githubOwner: null, githubRepo: null, slug: null })
      .where(eq(schema.games.id, 'g_1'))
      .run();
    vi.mocked(input.issues.findByMarkers).mockResolvedValue({ number: 7, url: 'https://example.test/7', labels: [] });
    await expect(input.intake.fileJob('j_1')).resolves.toEqual({ skipped: 'parent_terminal' });
    expect(input.issues.findByMarkers).toHaveBeenCalledWith('old/game', 'j_1', 'T1');
    expect(input.issues.close).toHaveBeenCalledWith('old/game', 7);
    close(input);
  });

  it('dispatches when admission arrives during queued child filing', async () => {
    const input = harness('feature');
    const job = input.db.select().from(schema.jobs).where(eq(schema.jobs.id, 'j_1')).get()!;
    input.db
      .insert(schema.jobs)
      .values({ ...job, id: 'j_parent', kind: 'new_game', idempotencyKey: null })
      .run();
    input.db
      .insert(schema.jobTickets)
      .values({ jobId: 'j_parent', key: 'new-game', issueNumber: 42, repo: 'owner/game', sig: 'parent' })
      .run();
    input.db
      .update(schema.jobs)
      .set({
        state: 'queued',
        idempotencyKey: 'planner:j_parent:starter',
        plan: JSON.stringify({ ...PLAN, tickets: [{ ...PLAN.tickets[0], skills: ['role:gameplay'] }] }),
      })
      .where(eq(schema.jobs.id, 'j_1'))
      .run();
    let promoted: Promise<unknown> | undefined;
    vi.mocked(input.aiur.setSpendCap).mockImplementationOnce(async (_id, usd) => {
      input.db.update(schema.jobs).set({ state: 'admitted' }).where(eq(schema.jobs.id, 'j_1')).run();
      promoted = input.intake.fileJob('j_1');
      return { amount: usd, currency: 'USD' } as Awaited<ReturnType<AiurClient['setSpendCap']>>;
    });
    await input.intake.fileJob('j_1');
    await promoted;
    expect(input.calls).toContain('label:1:lantern-bay:todo');
    expect(input.calls).toContain('nudge:1');
    expect(input.created).toHaveLength(1);
    close(input);
  });
});
