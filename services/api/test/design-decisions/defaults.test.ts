import { describe, expect, it } from 'vitest';

import { insertChatRow, listCheckpoints, parseCheckpoint } from '../../src/build-chat/store.js';
import { answerCheckpoint } from '../../src/checkpoints/answer.js';
import { designDefaultInterval, createDesignDefaultSweep } from '../../src/design-decisions/defaults.js';
import { listDesignDecisions } from '../../src/design-decisions/store.js';
import type { AppDeps } from '../../src/app/types.js';
import { makeApp, makeDeps } from '../helpers.js';
import {
  CP_ID,
  DECISION_ID,
  GAME,
  NOW,
  PARENT_TICKET,
  SCOPE_JOB,
  fakeAiur,
  insertOpenDesignCheckpoint,
  seedDesignGame,
} from './fixtures.js';

const AFTER_WAIT = '2026-11-04T18:06:00.000Z';
const BEFORE_WAIT = '2026-11-04T18:04:00.000Z';

// A design conversation's job, as the chat job directory serves it to the sweep.
function designJob(overrides: Record<string, unknown> = {}) {
  return {
    jobId: SCOPE_JOB,
    gameId: GAME,
    familyId: 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02',
    ownerId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03',
    kind: 'scope' as const,
    state: 'running' as const,
    aiur: { daemonSlug: 'game-1', ticket: String(PARENT_TICKET) },
    ...overrides,
  };
}

async function setup(options: { jobs?: ReturnType<typeof designJob>[]; now?: string } = {}) {
  const deps = makeDeps();
  seedDesignGame(deps);
  const client = fakeAiur();
  const jobs = options.jobs ?? [designJob()];
  deps.registry.chatJobs = {
    get: async (jobId: string) => jobs.find((job) => job.jobId === jobId) ?? null,
    active: async () => jobs,
  } as unknown as NonNullable<AppDeps['registry']['chatJobs']>;
  deps.registry.aiurClientFor = () => client;
  const app = await makeApp(deps);
  const sweep = createDesignDefaultSweep({
    sqlite: deps.sqlite,
    jobs: () => deps.registry.chatJobs,
    defaultMs: 300_000,
    intervalMs: designDefaultInterval(300_000),
    answer: async ({ job, row, optionId }) => {
      const outcome = await answerCheckpoint({ deps, job, row, optionId, source: 'default' });
      return outcome.kind === 'answered' ? { answered: true } : { answered: false, reason: outcome.kind };
    },
    log: deps.log,
    now: () => new Date(options.now ?? NOW),
  });
  return { app, deps, client, sweep };
}

function checkpointRow(deps: AppDeps) {
  const row = listCheckpoints(deps.sqlite, SCOPE_JOB).at(-1);
  return row === undefined ? null : parseCheckpoint(row);
}

describe('design default sweep', () => {
  it('answers an open design Command with its recommendation once the wait has passed', async () => {
    const { deps, client, sweep } = await setup({ now: AFTER_WAIT });
    insertOpenDesignCheckpoint(deps);

    expect(await sweep.tick()).toBe(1);

    expect(checkpointRow(deps)).toMatchObject({ status: 'answered', option_id: 'iron' });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([
      expect.objectContaining({
        id: 'D-01',
        checkpoint_id: CP_ID,
        decision_id: DECISION_ID,
        chosen: 'iron',
        recommended: 'iron',
        origin: 'default',
        skipped: false,
      }),
    ]);
    // The Executor is told the default stood in, so it can re-plan the Build Order if the player changes it.
    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]).toMatchObject({ ticket: String(PARENT_TICKET) });
    expect(client.messages[0]!.text).toContain('D-01');
    expect(client.messages[0]!.text).toContain('provisional default');
    expect(client.messages[0]!.text).toContain('"Iron"');
  });

  // A product question (#612) waits in its game's queue for a quick voice chat; a default would answer it unasked.
  it('never defaults a product question', async () => {
    const { deps, client, sweep } = await setup({ now: AFTER_WAIT });
    insertChatRow(deps.sqlite, {
      jobId: SCOPE_JOB,
      at: NOW,
      actor: 'agent',
      kind: 'checkpoint',
      checkpoint: {
        checkpoint_id: DECISION_ID,
        decision_id: DECISION_ID,
        version: 2,
        question: 'How many lives?',
        options: [
          { id: 'one', label: 'One' },
          { id: 'three', label: 'Three' },
        ],
        recommend: 'three',
        status: 'open',
        text_only: true,
      },
    });

    expect(await sweep.tick()).toBe(0);
    expect(checkpointRow(deps)).toMatchObject({ status: 'open' });
    expect(client.messages).toEqual([]);
  });

  it('leaves a Command open while its wait has not passed', async () => {
    const { deps, client, sweep } = await setup({ now: BEFORE_WAIT });
    insertOpenDesignCheckpoint(deps);

    expect(await sweep.tick()).toBe(0);

    expect(checkpointRow(deps)).toMatchObject({ status: 'open' });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([]);
    expect(client.messages).toEqual([]);
  });

  it('does not default a Command without a recommendation', async () => {
    const { deps, sweep } = await setup({ now: AFTER_WAIT });
    insertOpenDesignCheckpoint(deps, { recommend: null });

    expect(await sweep.tick()).toBe(0);
    expect(checkpointRow(deps)).toMatchObject({ status: 'open' });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([]);
  });

  it('leaves an edit’s Command to the player', async () => {
    const { deps, sweep } = await setup({ jobs: [designJob({ kind: 'feature' })], now: AFTER_WAIT });
    insertOpenDesignCheckpoint(deps);

    expect(await sweep.tick()).toBe(0);
    expect(checkpointRow(deps)).toMatchObject({ status: 'open' });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([]);
  });

  it('does not default a Command aiur already answered', async () => {
    const { deps, sweep } = await setup({ now: AFTER_WAIT });
    insertOpenDesignCheckpoint(deps);
    const row = listCheckpoints(deps.sqlite, SCOPE_JOB).at(-1)!;
    const answered = await answerCheckpoint({
      deps,
      job: designJob() as unknown as Parameters<typeof answerCheckpoint>[0]['job'],
      row,
      optionId: 'wood',
      source: 'player',
    });
    expect(answered.kind).toBe('answered');

    expect(await sweep.tick()).toBe(0);
    expect(checkpointRow(deps)).toMatchObject({ status: 'answered', option_id: 'wood' });
    // The player's answer stands: the sweep records nothing and does not overwrite it with the recommendation.
    expect(listDesignDecisions(deps.db, GAME)).toEqual([expect.objectContaining({ chosen: 'wood', origin: 'player' })]);
  });

  it('survives a job directory that cannot be read and reports it', async () => {
    const { deps, sweep } = await setup({ now: AFTER_WAIT });
    insertOpenDesignCheckpoint(deps);
    deps.registry.chatJobs = {
      get: async () => null,
      active: async () => {
        throw new Error('registry unavailable');
      },
    } as unknown as NonNullable<AppDeps['registry']['chatJobs']>;

    // The timer would otherwise carry an unhandled rejection; the tick reports nothing answered and logs why.
    expect(await sweep.tick()).toBe(0);
    expect(deps.lines.filter((line) => line.event === 'design-default-error')).toHaveLength(1);
    expect(checkpointRow(deps)).toMatchObject({ status: 'open' });
  });

  it('sweeps at a fraction of the wait, between one second and half a minute', () => {
    expect(designDefaultInterval(300_000)).toBe(30_000);
    expect(designDefaultInterval(8_000)).toBe(2_000);
    expect(designDefaultInterval(1_000)).toBe(1_000);
  });
});
