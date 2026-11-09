import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { schema } from '@ogm/db';
import { BriefingPush } from '@ogm/contracts';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { loadApiEnv } from '../../src/app/env.js';
import {
  buildBriefing,
  clearVoiceWaitingOn,
  pushBriefing,
  registerVoiceTarget,
  setVoiceWaitingOn,
  startBriefingPush,
  type VoiceTarget,
} from '../../src/voice/briefing-push.js';
import { ids, insertJob, NOW, worked } from '../budget/fixture.js';
import { makeApiEnv } from '../env-fixture.js';

const SECRET = 'voice-internal-secret-for-tests';
const defaults = { dailyAllowanceMicroUsd: 5_000_000, resetZone: 'America/Los_Angeles' };
const scope: VoiceTarget = { kind: 'scope', game_id: ids.game, session_id: 's_1', creator_id: ids.creator };
const build: VoiceTarget = {
  kind: 'build',
  game_id: ids.game,
  job_id: ids.running,
  ticket: '7',
  creator_id: ids.creator,
};
const budgetFixture = JSON.parse(
  readFileSync(new URL('../../../../fixtures/voice/budget-status.json', import.meta.url), 'utf8'),
) as {
  reset_zone: string;
  unit_label: string;
  micro_usd_per_unit: number;
  size_classes: Record<'small' | 'medium' | 'large' | 'huge', [number, number]>;
  expected: [string, string];
};

type Received = { auth: string | undefined; body: Record<string, unknown> };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function fakeHost(delayMs = 0, status = 204) {
  const received: Received[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      if (req.url === '/internal/briefing' && req.method === 'POST') {
        received.push({ auth: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> });
      }
      setTimeout(() => res.writeHead(status).end(), delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('buildBriefing', () => {
  it('matches the cross-language worked budget fixture exactly', async () => {
    const deps = worked();
    deps.db
      .insert(schema.familyBudgetSettings)
      .values({
        familyId: ids.family,
        resetZone: budgetFixture.reset_zone,
        unitLabel: budgetFixture.unit_label,
        microUsdPerUnit: budgetFixture.micro_usd_per_unit,
        slotsNewGame: 1,
        slotsEdit: 3,
        hardCapMultiplier: 1,
      })
      .run();
    for (const [sizeClass, [p50MicroUsd, p80MicroUsd]] of Object.entries(budgetFixture.size_classes)) {
      deps.db
        .update(schema.sizeClasses)
        .set({ p50MicroUsd, p80MicroUsd })
        .where(and(eq(schema.sizeClasses.kind, 'feature'), eq(schema.sizeClasses.sizeClass, sizeClass)))
        .run();
    }

    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, scope);

    expect(briefing.extra[0].text).toBe(budgetFixture.expected[0]);
    expect(briefing.sections[0].text).toBe(budgetFixture.expected.join('\n'));
    expect(briefing.sections[2].text).toBe(budgetFixture.expected[1]);
    expect(briefing.observed_at).toBe(NOW.toISOString());
  });

  it('puts the worked budget in the friendly unit, without dollars', async () => {
    const deps = worked();
    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, scope);
    expect(BriefingPush.safeParse(briefing).success).toBe(true);
    const text = briefing.extra[0].text;
    expect(briefing.target_key).toBe('scope:s_1');
    expect(briefing.extra[0].title).toBe('Budget');
    expect(text).toBe(
      'Remaining today: 20.0 energy (40%). Resets at 12:00 am. ' + 'Free slots: 1 new game, 2 edits. Queued: none.',
    );
    expect(briefing.sections.map((section) => section.id)).toEqual(['budget', 'progress', 'estimate']);
    expect(briefing.sections[0].text).toBe(
      text + '\nRough sizes: small ≈ 5–15 energy, medium ≈ 15–40, large ≈ 40–90, huge ≈ 90+ (low confidence).',
    );
    expect(briefing.sections[2].text).toBe(
      'Rough sizes: small ≈ 5–15 energy, medium ≈ 15–40, large ≈ 40–90, huge ≈ 90+ (low confidence).',
    );
    expect(JSON.stringify(briefing)).not.toMatch(/\$|usd|dollar/i);
  });

  it('reports a build waiting on an admin with its stage words', async () => {
    const deps = worked();
    deps.db.update(schema.jobs).set({ state: 'paused_budget' }).where(eq(schema.jobs.id, ids.running)).run();
    const paused = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, build);
    expect(paused).toMatchObject({
      target_key: 'build:' + ids.running,
      waiting_on: 'Build paused at its reservation: ask an admin to raise it, or trim',
      summary: 'Goblin camp',
    });
    expect(paused.extra[0].text).toMatch(/^Build paused at its reservation\. Remaining today:/);
    expect(paused.current_task).toBe('paused_budget');

    deps.db
      .insert(schema.jobProjections)
      .values({
        jobId: ids.running,
        daemonSlug: 'd',
        ticket: '7',
        stage: 'building',
        stageText: 'Building',
        updatedAt: NOW.toISOString(),
      })
      .run();
    const staged = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, build);
    expect(staged.current_task).toBe('Building');
    expect(staged.sections[1]).toEqual({ id: 'progress', text: 'Building' });
  });

  it('describes a scope session before the new game exists', async () => {
    const deps = worked();
    deps.db.delete(schema.games).where(eq(schema.games.id, ids.game)).run();

    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, scope);

    expect(briefing.summary).toBe('a new game');
    expect(briefing.extra[0].text).toContain('Remaining today: 50.0 energy');
  });

  it('includes open command questions in the order they were opened', async () => {
    const deps = worked();
    deps.db
      .insert(schema.commands)
      .values([
        {
          decisionId: 'd_second',
          jobId: ids.running,
          daemonSlug: 'daemon',
          version: 1,
          question: 'Which color should the camp use?',
          options: JSON.stringify([{ id: 'blue', label: 'Blue' }]),
          status: 'open',
          openedAt: '2026-10-31T19:02:00.000Z',
        },
        {
          decisionId: 'd_answered',
          jobId: ids.running,
          daemonSlug: 'daemon',
          version: 1,
          question: 'Should the gate open inward?',
          options: '[]',
          status: 'answered',
          openedAt: '2026-10-31T19:00:00.000Z',
          answeredAt: '2026-10-31T19:01:00.000Z',
        },
        {
          decisionId: 'd_first',
          jobId: ids.running,
          daemonSlug: 'daemon',
          version: 1,
          question: 'How many goblins should appear?',
          options: JSON.stringify([
            { id: 'three', label: 'Three' },
            { id: 'five', label: 'Five' },
          ]),
          status: 'open',
          openedAt: '2026-10-31T19:01:00.000Z',
        },
      ])
      .run();

    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, build);

    expect(briefing.questions).toEqual(['How many goblins should appear?', 'Which color should the camp use?']);
    expect(briefing.commands).toEqual([
      {
        id: 'd_first',
        version: 1,
        question: 'How many goblins should appear?',
        options: [
          { id: 'three', label: 'Three' },
          { id: 'five', label: 'Five' },
        ],
      },
      {
        id: 'd_second',
        version: 1,
        question: 'Which color should the camp use?',
        options: [{ id: 'blue', label: 'Blue' }],
      },
    ]);
  });

  it("uses the scope session's job when a newer job exists for the game", async () => {
    const deps = worked();
    deps.db
      .insert(schema.scopeSessions)
      .values({
        id: scope.session_id,
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
    const otherJob = 'j_18000000-0000-4000-8000-000000000099';
    insertJob(deps, {
      id: otherJob,
      creatorId: ids.other,
      createdAt: '2026-10-31T20:01:00.000Z',
      updatedAt: '2026-10-31T20:01:00.000Z',
    });
    deps.db
      .insert(schema.commands)
      .values([
        {
          decisionId: 'd_scope',
          jobId: ids.running,
          daemonSlug: 'daemon',
          version: 1,
          question: 'Which scope should this request use?',
          options: '[]',
          status: 'open',
          openedAt: NOW.toISOString(),
        },
        {
          decisionId: 'd_other',
          jobId: otherJob,
          daemonSlug: 'daemon',
          version: 1,
          question: 'Should another request ship?',
          options: '[]',
          status: 'open',
          openedAt: NOW.toISOString(),
        },
      ])
      .run();

    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, scope);

    expect(briefing.commands.map(({ id }) => id)).toEqual(['d_scope']);
  });

  it('omits budget claims when estimate data is unavailable', async () => {
    const deps = worked();
    deps.db
      .insert(schema.scopeSessions)
      .values({
        id: scope.session_id,
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
    deps.db.delete(schema.sizeClasses).run();

    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, scope);

    expect(briefing.extra).toEqual([]);
    expect(briefing.sections).toEqual([{ id: 'progress', text: 'running' }]);
  });

  it('carries a pending over-budget choice into the next status', async () => {
    const deps = worked();
    setVoiceWaitingOn(scope, "Doesn't fit today: trim, split, queue for 12:00 am, or ask an admin");

    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, scope);

    expect(briefing.waiting_on).toBe("Doesn't fit today: trim, split, queue for 12:00 am, or ask an admin");
    clearVoiceWaitingOn(scope);
  });
});

describe('pushBriefing', () => {
  it('posts the T06 briefing with the bearer', async () => {
    const deps = worked();
    const host = await fakeHost();
    // A cold first connection can outlast 300 ms; this case checks the shape, not the deadline.
    await pushBriefing(
      { db: deps.db, defaults, url: host.url, secret: SECRET, log: deps.log, timeoutMs: 5_000 },
      scope,
    );
    expect(host.received).toHaveLength(1);
    expect(host.received[0].auth).toBe(`Bearer ${SECRET}`);
    expect(Object.keys(host.received[0].body).sort()).toEqual(
      [
        'commands',
        'current_task',
        'extra',
        'next_steps',
        'observed_at',
        'questions',
        'sections',
        'summary',
        'target_key',
      ].sort(),
    );
  });

  it('gives up at 300 ms without throwing and logs once a minute per target', async () => {
    const deps = worked();
    const host = await fakeHost(1_000);
    const pushDeps = { db: deps.db, defaults, url: host.url, secret: SECRET, log: deps.log };
    const slow: VoiceTarget = { ...scope, session_id: 's_slow' };
    const started = Date.now();
    await expect(pushBriefing(pushDeps, slow)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(900);
    await pushBriefing(pushDeps, slow);
    expect(deps.lines.filter((line) => line.event === 'briefing-push-failed')).toHaveLength(1);
    cleanups.push(startBriefingPush({ ...pushDeps, events: deps.events })); // clears the failure log
  });

  it('logs a voice host that refuses the push', async () => {
    const deps = worked();
    const host = await fakeHost(0, 401);
    await pushBriefing(
      { db: deps.db, defaults, url: host.url, secret: SECRET, log: deps.log, timeoutMs: 5_000 },
      { ...scope, session_id: 's_401' },
    );
    expect(deps.lines).toContainEqual(
      expect.objectContaining({
        event: 'briefing-push-failed',
        target_key: 'scope:s_401',
        error: 'voice host answered 401',
      }),
    );
  });

  it('survives a voice host that is down', async () => {
    const deps = worked();
    await expect(
      pushBriefing(
        { db: deps.db, defaults, url: 'http://127.0.0.1:9', secret: SECRET, log: deps.log },
        { ...scope, session_id: 's_down' },
      ),
    ).resolves.toBeUndefined();
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'briefing-push-failed', target_key: 'scope:s_down' }),
    );
  });
});

describe('subscriptions', () => {
  it('pushes once for a registered creator on budget.changed and never for others', async () => {
    const deps = worked();
    const host = await fakeHost();
    cleanups.push(
      startBriefingPush({
        db: deps.db,
        defaults,
        url: host.url,
        secret: SECRET,
        log: deps.log,
        events: deps.events,
        debounceMs: 20,
      }),
    );
    registerVoiceTarget(scope);
    await expect.poll(() => host.received.length).toBe(1);

    deps.events.emit('budget.changed', { familyId: ids.family, userId: ids.creator });
    deps.events.emit('budget.changed', { familyId: ids.family, userId: ids.creator });
    deps.events.emit('budget.changed', { familyId: ids.family, userId: ids.other });
    await expect.poll(() => host.received.length).toBe(2);

    deps.events.emit('job.changed', { jobId: ids.running, gameId: ids.game, familyId: ids.family, state: 'running' });
    await expect.poll(() => host.received.length).toBe(3);
  });

  it('stops pushing after the target expires', async () => {
    const deps = worked();
    const host = await fakeHost();
    cleanups.push(
      startBriefingPush({
        db: deps.db,
        defaults,
        url: host.url,
        secret: SECRET,
        log: deps.log,
        events: deps.events,
        debounceMs: 20,
      }),
    );
    registerVoiceTarget(scope, 0);
    deps.events.emit('budget.changed', { familyId: ids.family, userId: ids.creator });
    await settle(150);
    expect(host.received).toHaveLength(1); // the registration push only
  });

  it('refreshes a live target on the periodic interval', async () => {
    const deps = worked();
    const host = await fakeHost();
    cleanups.push(
      startBriefingPush({
        db: deps.db,
        defaults,
        url: host.url,
        secret: SECRET,
        log: deps.log,
        events: deps.events,
        intervalMs: 40,
      }),
    );
    registerVoiceTarget(scope);
    await expect.poll(() => host.received.length).toBeGreaterThanOrEqual(2);
  });
});

describe('voice host env', () => {
  const baseEnv = makeApiEnv();

  it('sends the secret only to a loopback voice host', () => {
    expect(
      loadApiEnv({
        ...baseEnv,
        OGM_VOICE_HOST_INTERNAL_URL: 'http://127.0.0.1:4700',
        OGM_VOICE_INTERNAL_SECRET: SECRET,
      }),
    ).toMatchObject({ OGM_VOICE_HOST_INTERNAL_URL: 'http://127.0.0.1:4700' });
    expect(() =>
      loadApiEnv({
        ...baseEnv,
        OGM_VOICE_HOST_INTERNAL_URL: 'http://10.0.0.5:4000',
        OGM_VOICE_INTERNAL_SECRET: SECRET,
      }),
    ).toThrow(/OGM_VOICE_HOST_INTERNAL_URL/);
    expect(() => loadApiEnv({ ...baseEnv, OGM_VOICE_HOST_INTERNAL_URL: 'http://127.0.0.1:4700' })).toThrow(
      /OGM_VOICE_INTERNAL_SECRET/,
    );
    expect(loadApiEnv(baseEnv).OGM_VOICE_HOST_INTERNAL_URL).toBeUndefined();
    expect(loadApiEnv(baseEnv).OGM_NARRATION_CONCURRENCY).toBe(2);
    expect(() => loadApiEnv({ ...baseEnv, OGM_NARRATION_CONCURRENCY: '0' })).toThrow(/OGM_NARRATION_CONCURRENCY/);
  });
});
