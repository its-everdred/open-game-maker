import { describe, expect, it } from 'vitest';

import { answerRound, consumeRound, getRound, postRound, submitRound } from '../../src/review-rounds/store.js';
import { makeDeps } from '../helpers.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';

function setup() {
  const deps = makeDeps();
  seedDesignGame(deps);
  const round = {
    id: 'round-1',
    gameId: GAME,
    track: 'art',
    phase: 'concept',
    category: 'art' as const,
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-11-14T00:00:00Z',
  };
  postRound(deps.db, round);
  return { deps, round };
}

describe('review round posting', () => {
  it('does not attach one preview build to two rounds', () => {
    const { deps } = setup();
    const input = {
      id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
      track: 'game',
      phase: 'concept',
      category: 'gameplay' as const,
      ticket: '42',
      sha: 'a'.repeat(40),
      media: [{ kind: 'build' as const, ref: 'preview-1' }],
      question: 'Is it fun?',
    };
    submitRound(deps.db, GAME, input);
    expect(() => submitRound(deps.db, GAME, { ...input, id: 'd9428888-122b-4b0e-b1c8-9f7900000002' })).toThrow(
      'review_build_already_used',
    );
  });

  it('reuses an identical submission id and refuses conflicting retries', () => {
    const { deps } = setup();
    const submission = {
      id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
      track: 'sound',
      phase: 'cue',
      category: 'sound' as const,
      ticket: '42',
      sha: 'a'.repeat(40),
      media: [{ kind: 'clip' as const, ref: 'clip.mp4', hasAudio: true }],
    };
    const first = submitRound(deps.db, GAME, submission);
    expect(submitRound(deps.db, GAME, submission)).toEqual(first);
    expect(() => submitRound(deps.db, GAME, { ...submission, ticket: '43' })).toThrow('review_submission_conflict');
    expect(submitRound(deps.db, GAME, { ...submission, id: 'd9428888-122b-4b0e-b1c8-9f7900000002' }).round).toBe(2);
  });
});

describe('review rounds', () => {
  it('keeps each round and rejects duplicate phase and round identities', () => {
    const { deps, round } = setup();
    expect(() => postRound(deps.db, { ...round, id: 'another' })).toThrow();
    postRound(deps.db, { ...round, id: 'round-2', round: 2 });
    expect(getRound(deps.db, GAME, round.id)?.round).toBe(1);
    expect(getRound(deps.db, GAME, 'round-2')?.round).toBe(2);
  });

  it('records one immutable answer and treats duplicate delivery as a retry', () => {
    const { deps, round } = setup();
    expect(consumeRound(deps.db, GAME, round.id, 'early', '2026-11-14T00:30:00Z')).toBe(false);
    const answer = {
      verdict: 'needs_work' as const,
      notes: 'Keep this\nexactly.',
      source: 'preview' as const,
      at: '2026-11-14T01:00:00Z',
    };
    expect(answerRound(deps.db, GAME, round.id, answer)).toBe(true);
    expect(answerRound(deps.db, GAME, round.id, answer)).toBe(true);
    expect(answerRound(deps.db, GAME, round.id, { ...answer, verdict: 'approved' })).toBe(false);
    expect(getRound(deps.db, GAME, round.id)).toMatchObject({ verdict: 'needs_work', notes: answer.notes });
    expect(consumeRound(deps.db, GAME, round.id, 'run-1', answer.at)).toBe(true);
    expect(consumeRound(deps.db, GAME, round.id, 'run-2', answer.at)).toBe(false);
    expect(getRound(deps.db, GAME, round.id)?.consumedByRun).toBe('run-1');
  });
});
