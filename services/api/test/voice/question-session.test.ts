import type { AiurClient, CreatorAnswer, Decision } from '@ogm/aiur-client';
import { BriefingPush, CREATOR_AUDIENCE_MARKER, CREATOR_TEXT_ONLY_MARKER } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { recordDesignDecision } from '../../src/design-decisions/store.js';
import { buildBriefing, type VoiceTarget } from '../../src/voice/briefing-push.js';
import { answerVoiceCommand } from '../../src/voice/command-answer.js';
import { questionSession } from '../../src/voice/question-session.js';
import { ids, worked } from '../budget/fixture.js';
import { makeApp } from '../helpers.js';

// A quick question session (#612) is loaded with the game's queued product questions and its decision record, and
// saves each clear spoken answer to that question's Command. It never answers a decision meant for the review deck.

const target: VoiceTarget = { kind: 'questions', game_id: ids.game, creator_id: ids.creator };
const defaults = { dailyAllowanceMicroUsd: 5_000_000, resetZone: 'America/Los_Angeles' };

const decision = (id: string, markdown: string, createdAt: string): Decision => ({
  decision_id: id,
  version: 2,
  ticket: { identifier: '31' },
  kind: 'direction_checkpoint',
  authority: 'human_required',
  blocking: true,
  reversibility: 'reversible',
  question: `Question ${id}?`,
  options: [
    { id: 'one', label: 'One life' },
    { id: 'three', label: 'Three lives' },
  ],
  recommendation: { option_id: 'three' },
  context: { short_summary: `Topic ${id}`, long_context_markdown: markdown },
  answer: null,
  active_answer: null,
  created_at: createdAt,
  decision_status: 'open',
});

// The question list reads the build chat, which the app sets up.
async function fixture() {
  const deps = worked();
  await makeApp(deps);
  const answers: Array<{ id: string; answer: CreatorAnswer }> = [];
  const answerAsCreator = vi.fn(async (id: string, answer: CreatorAnswer) => {
    answers.push({ id, answer });
  });
  deps.aiurClientForGame = async () =>
    ({
      decisions: async () => [
        decision('q_later', `${CREATOR_AUDIENCE_MARKER}\n${CREATOR_TEXT_ONLY_MARKER}`, '2026-10-31T19:00:00.000Z'),
        decision('q_first', `${CREATOR_AUDIENCE_MARKER}\n${CREATOR_TEXT_ONLY_MARKER}`, '2026-10-31T18:00:00.000Z'),
        decision('d_look', CREATOR_AUDIENCE_MARKER, '2026-10-31T17:00:00.000Z'),
      ],
      answerAsCreator,
    }) as unknown as AiurClient;
  return { deps, answers };
}

describe('a quick question session', () => {
  it('asks the queued product questions oldest first, with the decision record, and nothing from the deck', async () => {
    const { deps } = await fixture();
    recordDesignDecision(deps.db, {
      gameId: ids.game,
      jobId: ids.running,
      ticket: '7',
      commandId: 'cp_settled',
      decisionId: 'd_settled',
      question: 'How long is a run?',
      options: [
        { id: 'short', label: 'Three minutes' },
        { id: 'long', label: 'Ten minutes' },
      ],
      recommended: 'short',
      chosen: 'short',
      origin: 'player',
    });

    const briefing = await buildBriefing(
      { db: deps.db, sqlite: deps.sqlite, defaults, questionSession: (gameId) => questionSession(deps, gameId) },
      target,
    );

    expect(BriefingPush.safeParse(briefing).success).toBe(true);
    expect(briefing.target_key).toBe(`questions:${ids.game}:${ids.creator}`);
    expect(briefing.commands?.map(({ id }) => id)).toEqual(['q_first', 'q_later']);
    const extra = Object.fromEntries(briefing.extra.map(({ title, text }) => [title, text]));
    expect(extra['Quick questions']).toContain('the builder recommends Three lives');
    expect(extra['Decision record']).toContain('How long is a run?: Three minutes');
  });

  it('saves a clear answer to the question’s Command as the creator', async () => {
    const { deps, answers } = await fixture();

    const result = await answerVoiceCommand(deps, {
      target,
      command_id: 'q_first',
      choice: 'three lives',
      idempotency_key: 'voice-1',
    });

    expect(result).toEqual({ status: 'answered' });
    expect(answers).toEqual([
      {
        id: 'q_first',
        answer: expect.objectContaining({
          ticket: '31',
          principal: ids.creator,
          option: 'three',
          expected_version: 2,
          idempotency_key: 'voice-1',
        }),
      },
    ]);
  });

  it('refuses a deck decision, an unknown question and words that are not an option', async () => {
    const { deps, answers } = await fixture();
    const ask = (command_id: string, choice: string) =>
      answerVoiceCommand(deps, { target, command_id, choice, idempotency_key: `${command_id}:${choice}` });

    expect(await ask('d_look', 'One life')).toEqual({ status: 'stale' });
    expect(await ask('q_gone', 'One life')).toEqual({ status: 'stale' });
    expect(await ask('q_first', 'either is fine')).toEqual({ status: 'failed' });
    expect(answers).toEqual([]);
  });
});
