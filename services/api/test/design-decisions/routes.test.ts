import type { DesignDecisionSummariesPage, DesignDecisionsPage } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { recordDesignDecision } from '../../src/design-decisions/store.js';
import { contextTokenSecret, signContextToken } from '../../src/new-game/token.js';
import { as, makeChatApp } from '../build-chat/setup.js';
import { CP_ID, DECISION_ID, GAME, NOW, SCOPE_JOB, seedDesignGame } from './fixtures.js';
import { INTERNAL_TOKEN, JOB_SECRET } from '../helpers.js';

const OPTIONS = [
  { id: 'wood', label: 'Wooden' },
  { id: 'iron', label: 'Iron' },
];

// A design agent's scoped request token: one New Game request and the game it belongs to.
function scoped(game: string): string {
  return signContextToken({ request: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f', game }, contextTokenSecret(JOB_SECRET))
    .token;
}

function decision(deps: Awaited<ReturnType<typeof setup>>['deps'], chosen: string, at: string) {
  return recordDesignDecision(deps.db, {
    gameId: GAME,
    jobId: SCOPE_JOB,
    ticket: '42',
    commandId: CP_ID,
    decisionId: DECISION_ID,
    question: 'Which door?',
    options: OPTIONS,
    recommended: 'iron',
    chosen,
    origin: chosen === 'iron' ? 'default' : 'player',
    at,
  });
}

async function setup() {
  const { app, deps } = await makeChatApp();
  seedDesignGame(deps);
  const get = (path: string, headers: Record<string, string> = {}) =>
    app.request(`http://127.0.0.1:4000${path}`, { headers });
  return { deps, get };
}

describe('GET /internal/games/:gameId/design-decisions', () => {
  it('serves the whole history to the internal credential only', async () => {
    const { deps, get } = await setup();
    decision(deps, 'iron', NOW);
    decision(deps, 'wood', '2026-11-04T18:10:00.000Z');

    expect((await get(`/internal/games/${GAME}/design-decisions`)).status).toBe(401);
    expect((await get(`/internal/games/${GAME}/design-decisions`, as('owner'))).status).toBe(401);
    expect((await get(`/internal/games/${GAME}/design-decisions`, { 'x-ogm-internal': 'wrong-token' })).status).toBe(
      401,
    );

    const response = await get(`/internal/games/${GAME}/design-decisions`, { 'x-ogm-internal': INTERNAL_TOKEN });
    expect(response.status).toBe(200);
    const page = (await response.json()) as DesignDecisionsPage;
    expect(page.decisions.map(({ id, chosen, origin, supersedes }) => ({ id, chosen, origin, supersedes }))).toEqual([
      { id: 'D-01', chosen: 'iron', origin: 'default', supersedes: null },
      { id: 'D-02', chosen: 'wood', origin: 'player', supersedes: 'D-01' },
    ]);
    // The design agent and the Executor re-plan from the options and what each decision affected.
    expect(page.decisions[0]).toMatchObject({
      options: OPTIONS,
      recommended: 'iron',
      affects: ['42'],
      decision_id: DECISION_ID,
      command_id: CP_ID,
    });
  });

  it('serves an empty history for a game without design decisions', async () => {
    const { get } = await setup();
    const response = await get(`/internal/games/${GAME}/design-decisions`, { 'x-ogm-internal': INTERNAL_TOKEN });
    expect(await response.json()).toEqual({ decisions: [] });
  });

  it('serves the history to the design agent’s scoped request token for this game only', async () => {
    const { deps, get } = await setup();
    decision(deps, 'iron', NOW);

    expect(
      (await get(`/internal/games/${GAME}/design-decisions`, { authorization: `Bearer ${scoped(GAME)}` })).status,
    ).toBe(200);
    // A token minted for another game's request opens nothing here.
    expect(
      (
        await get(`/internal/games/${GAME}/design-decisions`, {
          authorization: `Bearer ${scoped('g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e77')}`,
        })
      ).status,
    ).toBe(403);
    expect(
      (await get(`/internal/games/${GAME}/design-decisions`, { authorization: 'Bearer ngc1.not.a.token' })).status,
    ).toBe(401);
  });
});

describe('GET /api/v1/games/:gameId/design-decisions', () => {
  it('serves the player a readable summary without the option list', async () => {
    const { deps, get } = await setup();
    decision(deps, 'iron', NOW);

    const response = await get(`/api/v1/games/${GAME}/design-decisions`, as('owner'));

    expect(response.status).toBe(200);
    const page = (await response.json()) as DesignDecisionSummariesPage;
    expect(page.decisions).toEqual([
      {
        id: 'D-01',
        question: 'Which door?',
        chosen: 'iron',
        chosen_label: 'Iron',
        origin: 'default',
        skipped: false,
        supersedes: null,
        at: NOW,
      },
    ]);
    expect(page.decisions[0]).not.toHaveProperty('options');
    expect(page.decisions[0]).not.toHaveProperty('decision_id');
  });

  it('refuses a family player without a grant to the private game', async () => {
    const { deps, get } = await setup();
    decision(deps, 'iron', NOW);

    expect((await get(`/api/v1/games/${GAME}/design-decisions`, as('player'))).status).toBe(403);
  });

  it('reads a game outside the caller’s family as missing', async () => {
    const { get } = await setup();
    expect(
      (await get('/api/v1/games/g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e77/design-decisions', as('owner'))).status,
    ).toBe(404);
  });
});
