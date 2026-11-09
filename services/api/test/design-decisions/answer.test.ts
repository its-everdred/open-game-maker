import { describe, expect, it } from 'vitest';

import { listCommands, parseCommand, updateCommand } from '../../src/build-chat/store.js';
import { listDesignDecisions } from '../../src/design-decisions/store.js';
import { as, chatJob, jobTable, makeChatApp } from '../build-chat/setup.js';
import {
  CP_ID,
  DECISION_ID,
  GAME,
  PARENT_TICKET,
  SCOPE_JOB,
  fakeAiur,
  insertOpenDesignCommand,
  seedDesignGame,
} from './fixtures.js';

const json = { 'content-type': 'application/json' };

// The creation chat's design conversation, with the fake daemon client that answers its Commands. `seed: false` leaves
// the game and its jobs out of the database, so a decision write fails its foreign key — the case a writer has to
// survive without undoing the answer the Command already took.
async function setup(kind: 'scope' | 'feature' = 'scope', options: { seed?: boolean } = {}) {
  const client = fakeAiur();
  const jobs = jobTable(chatJob({ kind, aiur: { daemonSlug: 'game-1', ticket: String(PARENT_TICKET) } }));
  const { app, deps } = await makeChatApp(jobs, client);
  if (options.seed !== false) seedDesignGame(deps);
  return { app, deps, client };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

function answer(app: App, optionId: string, commandId = CP_ID) {
  return app.request(`/api/v1/jobs/${SCOPE_JOB}/commands/${commandId}/answer`, {
    method: 'POST',
    headers: { ...json, ...as('owner') },
    body: JSON.stringify({ option_id: optionId }),
  });
}

function skip(app: App, commandId = CP_ID) {
  return app.request(`/api/v1/jobs/${SCOPE_JOB}/commands/${commandId}/skip`, {
    method: 'POST',
    headers: { ...json, ...as('owner') },
  });
}

describe('design decisions recorded from the build chat', () => {
  it('records the player’s answer as the first decision for the Command', async () => {
    const { app, deps, client } = await setup();
    insertOpenDesignCommand(deps);

    const response = await answer(app, 'wood');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'answered', decision_id: DECISION_ID, option_id: 'wood' });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([
      expect.objectContaining({ id: 'D-01', chosen: 'wood', origin: 'player', skipped: false, supersedes: null }),
    ]);
    // A first answer changes nothing earlier, so the Executor is not messaged.
    expect(client.messages).toEqual([]);
  });

  it('answers with the recommendation when the player skips the question', async () => {
    const { app, deps } = await setup();
    insertOpenDesignCommand(deps);

    const response = await skip(app);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'answered', option_id: 'iron' });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([
      expect.objectContaining({ chosen: 'iron', recommended: 'iron', skipped: true, origin: 'player' }),
    ]);
  });

  it('records a later answer as a decision that supersedes the earlier one and tells the Executor', async () => {
    const { app, deps, client } = await setup();
    insertOpenDesignCommand(deps);
    expect((await answer(app, 'iron')).status).toBe(200);

    const later = await answer(app, 'wood');

    expect(later.status).toBe(200);
    expect(await later.json()).toMatchObject({
      status: 'superseded',
      decision_id: DECISION_ID,
      option_id: 'wood',
      supersedes: 'D-01',
    });
    expect(
      listDesignDecisions(deps.db, GAME).map(({ id, chosen, supersedes }) => ({ id, chosen, supersedes })),
    ).toEqual([
      { id: 'D-01', chosen: 'iron', supersedes: null },
      { id: 'D-02', chosen: 'wood', supersedes: 'D-01' },
    ]);
    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]).toMatchObject({ ticket: String(PARENT_TICKET) });
    expect(client.messages[0]!.text).toContain('D-02');
    expect(client.messages[0]!.text).toContain('supersedes D-01');
    expect(client.messages[0]!.text).toContain('"Wooden"');
    expect(client.messages[0]!.text).toContain('instead of "Iron"');
    // The aiur Command keeps the answer it was given; the history is what carries the later choice.
    expect(parseCommand(listCommands(deps.sqlite, SCOPE_JOB).at(-1)!)).toMatchObject({
      status: 'answered',
      option_id: 'iron',
    });
  });

  it('tells the Executor about a later answer whose earlier one never reached the history', async () => {
    const { app, deps, client } = await setup();
    const rowId = insertOpenDesignCommand(deps);
    // An answer that arrived through aiur alone — voice, the dashboard — with the poller not yet having recorded it.
    updateCommand(deps.sqlite, rowId, { status: 'answered', option_id: 'iron' });

    const later = await answer(app, 'wood');

    expect(later.status).toBe(200);
    expect(listDesignDecisions(deps.db, GAME)).toEqual([
      expect.objectContaining({ id: 'D-01', chosen: 'wood', origin: 'player', supersedes: null }),
    ]);
    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]!.text).toContain('supersedes the earlier answer');
    expect(client.messages[0]!.text).toContain('"Wooden"');
  });

  it('answers a repeated answer as the answer already standing', async () => {
    const { app, deps, client } = await setup();
    insertOpenDesignCommand(deps);
    expect((await answer(app, 'wood')).status).toBe(200);

    const repeat = await answer(app, 'wood');

    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ status: 'answered', option_id: 'wood' });
    // A retry is not a conflict and records nothing twice.
    expect(listDesignDecisions(deps.db, GAME)).toHaveLength(1);
    expect(client.messages).toEqual([]);
  });

  it('refuses to skip a Command without a recommendation', async () => {
    const { app, deps } = await setup();
    insertOpenDesignCommand(deps, { recommend: null });

    const response = await skip(app);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'command_recommendation_missing' });
    expect(parseCommand(listCommands(deps.sqlite, SCOPE_JOB).at(-1)!)).toMatchObject({ status: 'open' });
  });

  it('does not record a design decision for an edit’s Command', async () => {
    const { app, deps } = await setup('feature');
    insertOpenDesignCommand(deps);

    expect((await answer(app, 'wood')).status).toBe(200);
    expect(parseCommand(listCommands(deps.sqlite, SCOPE_JOB).at(-1)!)).toMatchObject({ status: 'answered' });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([]);
  });

  it('answers the Command even when the decision cannot be recorded', async () => {
    const { app, deps } = await setup('scope', { seed: false });
    insertOpenDesignCommand(deps);

    const response = await answer(app, 'wood');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'answered', decision_id: DECISION_ID, option_id: 'wood' });
    expect(listDesignDecisions(deps.db, GAME)).toEqual([]);
    // The Command is answered and its card moves on; only the history write failed, and the operator can see why.
    expect(parseCommand(listCommands(deps.sqlite, SCOPE_JOB).at(-1)!)).toMatchObject({
      status: 'answered',
      option_id: 'wood',
    });
    expect(deps.lines.filter((line) => line.event === 'design-decision-record-error')).toHaveLength(1);
  });
});
