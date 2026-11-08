import type { AiurClient, Decision, DecisionAnswer } from '@ogm/aiur-client';
import { describe, expect, it } from 'vitest';

import { listCheckpoints, parseCheckpoint } from '../../src/build-chat/store.js';
import { listReviews, recordReview } from '../../src/reviews/store.js';
import type { AppDeps } from '../../src/app/types.js';
import { as, chatJob, jobTable, makeChatApp } from '../build-chat/setup.js';
import {
  CP_ID,
  GAME,
  PARENT_TICKET,
  SCOPE_JOB,
  answeredDecision,
  insertOpenDesignCheckpoint,
  seedDesignGame,
} from '../design-decisions/fixtures.js';

const json = { 'content-type': 'application/json' };

// A daemon client that records every decision answer, so a test can read the reasoning a review sends with the answer.
function recordingAiur() {
  const answers: DecisionAnswer[] = [];
  const client: Pick<AiurClient, 'message' | 'progress' | 'decisions' | 'decision' | 'decide'> = {
    message: async () => ({ request_id: 'r_test' }),
    progress: async () => [],
    decisions: async () => [],
    decision: async () => answeredDecision('iron'),
    decide: async (_id: string, answer: DecisionAnswer): Promise<Decision> => {
      answers.push(answer);
      return answeredDecision(answer.option ?? '');
    },
  };
  return { client, answers };
}

// The creation chat's design conversation with a Command that has two cards, so a review can judge both.
async function setup() {
  const { client, answers } = recordingAiur();
  const { app, deps } = await makeChatApp(
    jobTable(chatJob({ kind: 'scope', aiur: { daemonSlug: 'game-1', ticket: String(PARENT_TICKET) } })),
    client,
  );
  seedDesignGame(deps);
  return { app, deps, answers };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

const WOOD_AND_IRON = {
  likes: ['wood'],
  dislikes: [{ option_id: 'iron', reason: 'Too cold for the lantern room' }],
};

function answerReview(app: App, body: Record<string, unknown>) {
  return app.request(`/api/v1/jobs/${SCOPE_JOB}/checkpoints/${CP_ID}/answer`, {
    method: 'POST',
    headers: { ...json, ...as('owner') },
    body: JSON.stringify(body),
  });
}

function readLedger(app: App) {
  return app.request(`/api/v1/games/${GAME}/reviews`, { headers: as('owner') });
}

describe('review deck answers', () => {
  it('answers the Command and records the review in the game’s ledger', async () => {
    const { app, deps } = await setup();
    insertOpenDesignCheckpoint(deps);

    const response = await answerReview(app, { option_id: 'wood', review: WOOD_AND_IRON });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'answered', option_id: 'wood' });

    // The card labels come from the Command, so the ledger's reasons survive the Command and its signed media URLs.
    expect(listReviews(deps.db, GAME)).toEqual([
      expect.objectContaining({
        game_id: GAME,
        job_id: SCOPE_JOB,
        title: 'Lantern Bay',
        checkpoint_id: CP_ID,
        option_id: 'wood',
        likes: [{ option_id: 'wood', label: 'Wooden' }],
        dislikes: [{ option_id: 'iron', label: 'Iron', reason: 'Too cold for the lantern room' }],
      }),
    ]);
    // The answer also lands on the checkpoint row the inbox reads, so a reload shows the deck's ending grid.
    expect(parseCheckpoint(listCheckpoints(deps.sqlite, SCOPE_JOB).at(-1)!)).toMatchObject({
      status: 'answered',
      option_id: 'wood',
      review: WOOD_AND_IRON,
    });
  });

  it('serves the ledger back for the game, newest first', async () => {
    const { app, deps } = await setup();
    insertOpenDesignCheckpoint(deps);
    expect((await answerReview(app, { option_id: 'wood', review: WOOD_AND_IRON })).status).toBe(200);

    const response = await readLedger(app);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reviews: [
        {
          game_id: GAME,
          checkpoint_id: CP_ID,
          option_id: 'wood',
          likes: [{ option_id: 'wood', label: 'Wooden' }],
          dislikes: [{ option_id: 'iron', label: 'Iron', reason: 'Too cold for the lantern room' }],
        },
      ],
    });
  });

  it('sends the whole like and dislike map into the aiur decision', async () => {
    const { app, deps, answers } = await setup();
    insertOpenDesignCheckpoint(deps);

    expect((await answerReview(app, { option_id: 'wood', review: WOOD_AND_IRON })).status).toBe(200);

    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      option: 'wood',
      // The only like is the card the answer chose, so aiur's "other options considered" is empty and stays absent.
      rationale:
        "Creator chose 'Wooden' in the build chat. Reviewed the deck: liked Wooden; disliked Iron ('Too cold for the lantern room')",
    });
    expect(answers[0]!.alternatives_considered).toBeUndefined();
    // The map travels as JSON text in custom_response beside the option id, in aiur's multi-question shape, so the
    // worker reads every card's verdict and the creator's words off the decision's answer.
    expect(JSON.parse(answers[0]!.response ?? 'null')).toEqual({
      kind: 'question_answers',
      answers: [
        { option_id: 'wood', verdict: 'like' },
        { option_id: 'iron', verdict: 'dislike', reason: 'Too cold for the lantern room' },
      ],
    });
  });

  it('names the likes the creator passed over as aiur’s alternatives, never the chosen card', async () => {
    const { app, deps, answers } = await setup();
    insertOpenDesignCheckpoint(deps, {
      options: [
        { id: 'wood', label: 'Wooden' },
        { id: 'iron', label: 'Iron' },
        { id: 'oak', label: 'Oaken' },
      ],
    });
    const review = {
      likes: ['wood', 'oak'],
      dislikes: [{ option_id: 'iron', reason: 'Too cold for the lantern room' }],
    };

    expect((await answerReview(app, { option_id: 'oak', review })).status).toBe(200);

    // 'oak' is the answer, so the alternatives aiur records are the likes left over: 'wood', and never 'oak' itself.
    expect(answers[0]).toMatchObject({ option: 'oak', alternatives_considered: ['wood'] });
  });

  it('carries the whole-set notes beside the per-card votes and into the ledger', async () => {
    const { app, deps, answers } = await setup();
    insertOpenDesignCheckpoint(deps);
    const review = { ...WOOD_AND_IRON, notes: 'All of these read too cold for the lantern room.' };

    expect((await answerReview(app, { option_id: 'wood', review })).status).toBe(200);

    expect(JSON.parse(answers[0]!.response ?? 'null')).toMatchObject({
      kind: 'question_answers',
      notes: 'All of these read too cold for the lantern room.',
    });
    expect(listReviews(deps.db, GAME)[0]).toMatchObject({
      notes: 'All of these read too cold for the lantern room.',
      dislikes: [{ option_id: 'iron', label: 'Iron', reason: 'Too cold for the lantern room' }],
    });
    expect(parseCheckpoint(listCheckpoints(deps.sqlite, SCOPE_JOB).at(-1)!)).toMatchObject({
      status: 'answered',
      review: { notes: 'All of these read too cold for the lantern room.' },
    });
  });

  it('takes a half-judged review, since Send is always on, and records only the cards judged', async () => {
    const { app, deps, answers } = await setup();
    insertOpenDesignCheckpoint(deps);

    const response = await answerReview(app, { option_id: 'wood', review: { likes: ['wood'], dislikes: [] } });

    expect(response.status).toBe(200);
    expect(JSON.parse(answers[0]!.response ?? 'null')).toEqual({
      kind: 'question_answers',
      answers: [{ option_id: 'wood', verdict: 'like' }],
    });
    expect(listReviews(deps.db, GAME)[0]).toMatchObject({ likes: [{ option_id: 'wood' }], dislikes: [] });
  });

  it('refuses a review that names a card the Command does not have', async () => {
    const { app, deps } = await setup();
    insertOpenDesignCheckpoint(deps);

    const response = await answerReview(app, {
      option_id: 'wood',
      review: { likes: ['wood', 'lava'], dislikes: [{ option_id: 'iron' }] },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'checkpoint_review_invalid' });
    expect(listReviews(deps.db, GAME)).toEqual([]);
  });

  it('records no ledger row for a plain answer without a review', async () => {
    const { app, deps } = await setup();
    insertOpenDesignCheckpoint(deps);

    expect((await answerReview(app, { option_id: 'wood' })).status).toBe(200);

    expect(listReviews(deps.db, GAME)).toEqual([]);
  });

  it('keeps one ledger row when the same review is answered twice', async () => {
    const { app, deps } = await setup();
    insertOpenDesignCheckpoint(deps);
    expect((await answerReview(app, { option_id: 'wood', review: WOOD_AND_IRON })).status).toBe(200);

    const again = await answerReview(app, { option_id: 'wood', review: WOOD_AND_IRON });

    expect(again.status).toBe(200);
    expect(listReviews(deps.db, GAME)).toHaveLength(1);
  });
});

// The ledger writer on its own: the answer route calls it, and #567 reads the same rows for design/feedback.json.
describe('recordReview', () => {
  function commandOf(deps: AppDeps) {
    insertOpenDesignCheckpoint(deps);
    const checkpoint = parseCheckpoint(listCheckpoints(deps.sqlite, SCOPE_JOB).at(-1)!)!;
    return {
      job_id: SCOPE_JOB,
      ticket: String(PARENT_TICKET),
      title: 'Lantern Bay',
      checkpoint_id: checkpoint.checkpoint_id!,
      decision_id: checkpoint.decision_id,
      version: checkpoint.version,
      question: checkpoint.question,
      options: checkpoint.options,
      blocking: checkpoint.blocking ?? false,
      opened_at: '2026-11-04T18:00:00.000Z',
    };
  }

  it('labels each card from the Command and keeps a dislike’s words', async () => {
    const { deps } = await setup();
    const command = commandOf(deps);

    const entry = recordReview(deps.db, {
      gameId: GAME,
      command,
      optionId: 'wood',
      review: WOOD_AND_IRON,
      at: '2026-11-07T17:45:00.000Z',
    });

    expect(entry).toMatchObject({
      option_id: 'wood',
      likes: [{ option_id: 'wood', label: 'Wooden' }],
      dislikes: [{ option_id: 'iron', label: 'Iron', reason: 'Too cold for the lantern room' }],
      at: '2026-11-07T17:45:00.000Z',
    });
  });

  it('records nothing when the same answer is written again', async () => {
    const { deps } = await setup();
    const command = commandOf(deps);
    const input = { gameId: GAME, command, optionId: 'wood', review: WOOD_AND_IRON };

    const first = recordReview(deps.db, input);
    const second = recordReview(deps.db, input);

    expect(second).toEqual(first);
    expect(listReviews(deps.db, GAME)).toHaveLength(1);
  });

  it('records a new row when the creator changes the review', async () => {
    const { deps } = await setup();
    const command = commandOf(deps);
    recordReview(deps.db, { gameId: GAME, command, optionId: 'wood', review: WOOD_AND_IRON });

    recordReview(deps.db, {
      gameId: GAME,
      command,
      optionId: 'iron',
      review: { likes: ['iron'], dislikes: [{ option_id: 'wood' }] },
    });

    expect(listReviews(deps.db, GAME).map(({ option_id }) => option_id)).toEqual(['iron', 'wood']);
  });

  it('keeps the whole-set notes, and records a new row when only the notes change', async () => {
    const { deps } = await setup();
    const command = commandOf(deps);
    const notes = 'All of these read too cold for the lantern room.';
    const first = recordReview(deps.db, {
      gameId: GAME,
      command,
      optionId: 'wood',
      review: { ...WOOD_AND_IRON, notes },
      at: '2026-11-07T17:45:00.000Z',
    });

    expect(first).toMatchObject({ notes });
    // A plain review with no set-level words reads as null, not as an empty string.
    expect(
      recordReview(deps.db, {
        gameId: GAME,
        command,
        optionId: 'wood',
        review: WOOD_AND_IRON,
        at: '2026-11-07T17:46:00.000Z',
      }),
    ).toMatchObject({ notes: null });

    const changed = recordReview(deps.db, {
      gameId: GAME,
      command,
      optionId: 'wood',
      review: { ...WOOD_AND_IRON, notes: 'Warmer voices only.' },
      at: '2026-11-07T17:47:00.000Z',
    });

    expect(changed).toMatchObject({ notes: 'Warmer voices only.' });
    expect(listReviews(deps.db, GAME).map(({ notes: value }) => value)).toEqual(['Warmer voices only.', null, notes]);
  });
});
