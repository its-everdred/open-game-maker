import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import {
  decisionId,
  isDesignJob,
  latestForCommand,
  listDesignDecisions,
  recordDesignDecision,
} from '../../src/design-decisions/store.js';
import { makeDeps } from '../helpers.js';
import { CP_ID, DECISION_ID, GAME, NOW, SCOPE_JOB, seedDesignGame } from './fixtures.js';

const OPTIONS = [
  { id: 'wood', label: 'Wooden' },
  { id: 'iron', label: 'Iron' },
];

function setup() {
  const deps = makeDeps();
  seedDesignGame(deps);
  return deps;
}

function record(deps: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
  return recordDesignDecision(deps.db, {
    gameId: GAME,
    jobId: SCOPE_JOB,
    ticket: '42',
    commandId: CP_ID,
    decisionId: DECISION_ID,
    question: 'Which door?',
    options: OPTIONS,
    recommended: 'iron',
    chosen: 'iron',
    origin: 'player',
    at: NOW,
    ...overrides,
  });
}

describe('design decision ids', () => {
  it('numbers a game’s decisions from D-01 and keeps two digits', () => {
    expect(decisionId(1)).toBe('D-01');
    expect(decisionId(9)).toBe('D-09');
    expect(decisionId(10)).toBe('D-10');
    expect(decisionId(120)).toBe('D-120');
  });

  it('treats the creation chat and the New Game request as design conversations, an edit as not', () => {
    expect(isDesignJob('scope')).toBe(true);
    expect(isDesignJob('new_game')).toBe(true);
    expect(isDesignJob('feature')).toBe(false);
    expect(isDesignJob('repair')).toBe(false);
  });
});

describe('recordDesignDecision', () => {
  it('records the player’s answer with the question, options and the ticket it affects', () => {
    const deps = setup();
    const { decision, created } = record(deps, { chosen: 'wood' });

    expect(created).toBe(true);
    expect(decision).toMatchObject({
      id: 'D-01',
      game_id: GAME,
      job_id: SCOPE_JOB,
      ticket: '42',
      command_id: CP_ID,
      decision_id: DECISION_ID,
      question: 'Which door?',
      options: OPTIONS,
      recommended: 'iron',
      chosen: 'wood',
      origin: 'player',
      skipped: false,
      affects: ['42'],
      supersedes: null,
    });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([decision]);
  });

  it('records a repeated answer to the same Command once', () => {
    const deps = setup();
    record(deps);
    const repeat = record(deps);

    expect(repeat).toMatchObject({ created: false, changed: false });
    expect(listDesignDecisions(deps.db, GAME)).toHaveLength(1);
  });

  it('gives a provisional default the attribution when the poller saw its answer first', () => {
    const deps = setup();
    // The poller sees the default's answer in aiur before the sweep records it, so it lands as the player's choice.
    record(deps, { origin: 'player' });
    const promoted = record(deps, { origin: 'default' });

    expect(promoted).toMatchObject({ created: false, changed: true });
    expect(promoted.decision.origin).toBe('default');
    const history = listDesignDecisions(deps.db, GAME);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ origin: 'default', chosen: 'iron' });
  });

  it('marks a skipped question on the decision the player delegated', () => {
    const deps = setup();
    record(deps);
    const skipped = record(deps, { skipped: true });

    expect(skipped).toMatchObject({ created: false, changed: true });
    expect(listDesignDecisions(deps.db, GAME)[0]).toMatchObject({ skipped: true, origin: 'player' });
  });

  it('records a later answer as a new decision that supersedes the earlier one', () => {
    const deps = setup();
    record(deps, { chosen: 'iron' });
    const later = record(deps, { chosen: 'wood' });

    expect(later.created).toBe(true);
    expect(later.decision).toMatchObject({ id: 'D-02', chosen: 'wood', supersedes: 'D-01' });
    expect(
      listDesignDecisions(deps.db, GAME).map(({ id, chosen, supersedes }) => ({ id, chosen, supersedes })),
    ).toEqual([
      { id: 'D-01', chosen: 'iron', supersedes: null },
      { id: 'D-02', chosen: 'wood', supersedes: 'D-01' },
    ]);
    expect(latestForCommand(deps.db, GAME, CP_ID)).toMatchObject({ id: 'D-02', chosen: 'wood' });
  });

  it('numbers each game’s history from D-01', () => {
    const deps = setup();
    const other = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e99';
    deps.db
      .insert(schema.games)
      .values({
        id: other,
        familyId: 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02',
        ownerId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03',
        title: 'Other Game',
        visibility: 'private',
        repoVisibility: 'private',
        createdAt: NOW,
      })
      .run();
    const otherJob = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e98';
    deps.db
      .insert(schema.jobs)
      .values({
        id: otherJob,
        gameId: other,
        branchId: 'main',
        familyId: 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e02',
        creatorId: 'u_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e03',
        kind: 'scope',
        complexity: 1,
        state: 'filed',
        start: 'now',
        slot: 'edit',
        plan: '{}',
        reservation: '{}',
        hardCapMicroUsd: 0,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    record(deps);
    const otherDecision = recordDesignDecision(deps.db, {
      gameId: other,
      jobId: otherJob,
      ticket: null,
      commandId: 'cp_other',
      decisionId: 'd_other',
      question: 'Which sky?',
      options: OPTIONS,
      recommended: null,
      chosen: 'wood',
      origin: 'player',
      at: NOW,
    });

    expect(otherDecision.decision).toMatchObject({ id: 'D-01', game_id: other, affects: [] });
    expect(listDesignDecisions(deps.db, GAME)).toHaveLength(1);
  });
});
