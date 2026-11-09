import { describe, expect, it } from 'vitest';

import { listCommands, parseCommand } from '../../src/build-chat/store.js';
import { createInboxWriter } from '../../src/job-commands/inbox.js';
import { createCommandPoller } from '../../src/job-commands/poller.js';
import { listDesignDecisions } from '../../src/design-decisions/store.js';
import type { AppDeps } from '../../src/app/types.js';
import { makeDeps } from '../helpers.js';
import {
  DECISION_ID,
  GAME,
  PARENT_TICKET,
  SCOPE_JOB,
  answeredDecision,
  insertOpenDesignCommand,
  seedDesignGame,
} from './fixtures.js';

// The aiur decision an answer from outside this app leaves behind: voice, the aiur dashboard or the Executor.
const jobsFor = (kind: 'scope' | 'feature') => ({
  get: async (jobId: string) =>
    jobId === SCOPE_JOB
      ? {
          jobId: SCOPE_JOB,
          gameId: GAME,
          familyId: 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02',
          ownerId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03',
          kind,
          state: 'running' as const,
          aiur: { daemonSlug: 'game-1', ticket: String(PARENT_TICKET) },
        }
      : null,
  active: async () => [await jobsFor(kind).get(SCOPE_JOB)].filter((job) => job !== null),
});

function setup(kind: 'scope' | 'feature' = 'scope', options: { seed?: boolean } = {}) {
  const deps = makeDeps();
  if (options.seed !== false) seedDesignGame(deps);
  deps.registry.chatJobs = jobsFor(kind) as unknown as NonNullable<AppDeps['registry']['chatJobs']>;
  deps.registry.aiurClientFor = () => ({
    decisions: async () => [answeredDecision('wood')],
    decision: async () => answeredDecision('wood'),
    decide: async () => answeredDecision('wood'),
    message: async () => ({ request_id: 'r_test' }),
    progress: async () => [],
  });
  const poller = createCommandPoller({
    db: deps.db,
    sqlite: deps.sqlite,
    jobs: () => deps.registry.chatJobs,
    clientFor: () => deps.registry.aiurClientFor,
    inbox: createInboxWriter({ sqlite: deps.sqlite, log: deps.log }),
    publish: () => undefined,
    log: deps.log,
  });
  return { deps, poller };
}

describe('command poller and design decisions', () => {
  it('records an answer that reached aiur without this app answering it', async () => {
    const { deps, poller } = setup();
    insertOpenDesignCommand(deps);

    await poller.tick();

    expect(listDesignDecisions(deps.db, GAME)).toEqual([
      expect.objectContaining({
        id: 'D-01',
        command_id: 'cp_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e72',
        decision_id: DECISION_ID,
        chosen: 'wood',
        origin: 'player',
        supersedes: null,
      }),
    ]);
    // Whoever answered already knows; the poller records the decision without messaging the Executor.
    expect(deps.lines.filter((line) => String(line.event).startsWith('design-decision'))).toEqual([]);
  });

  it('records nothing for an edit’s Command', async () => {
    const { deps, poller } = setup('feature');
    insertOpenDesignCommand(deps);

    await poller.tick();

    expect(listDesignDecisions(deps.db, GAME)).toEqual([]);
  });

  it('still answers the card when the decision cannot be recorded', async () => {
    const { deps, poller } = setup('scope', { seed: false });
    insertOpenDesignCommand(deps);

    // A failed history write is not an aiur outage: the tick succeeds and the card still shows the answer.
    expect(await poller.tick()).toBe(false);
    expect(parseCommand(listCommands(deps.sqlite, SCOPE_JOB).at(-1)!)).toMatchObject({
      status: 'answered',
      option_id: 'wood',
    });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([]);
    expect(deps.lines.filter((line) => line.event === 'command-poll-error')).toEqual([]);
    expect(deps.lines.filter((line) => line.event === 'design-decision-record-error')).toHaveLength(1);
  });
});
