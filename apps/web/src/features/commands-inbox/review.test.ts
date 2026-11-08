import { describe, expect, it } from 'vitest';

import type { GameCommand } from '@ogm/contracts';

import { commandFixture } from './fixtures';
import {
  answerOf,
  clipLength,
  deckCards,
  deckFinished,
  deckReducer,
  initialDeck,
  mediaKindOf,
  reviewOf,
  shortlist,
  type DeckState,
} from './review';

function deck(overrides: Partial<GameCommand> = {}): GameCommand {
  return commandFixture({
    options: [
      {
        id: 'v1',
        label: 'Voice 1',
        media: { url: 'https://media.example.test/v1.wav', width: 320, height: 320, duration_ms: 2400 },
      },
      {
        id: 'v2',
        label: 'Voice 2',
        media: { url: 'https://media.example.test/v2.wav', width: 320, height: 320, duration_ms: 2400 },
      },
      {
        id: 'v3',
        label: 'Voice 3',
        media: { url: 'https://media.example.test/v3.wav', width: 320, height: 320, duration_ms: 2400 },
      },
    ],
    ...overrides,
  });
}

// Walks the deck's cards in order, judging each with the given verdict.
function judge(state: DeckState, ...verdicts: Array<'like' | 'dislike'>): DeckState {
  return verdicts.reduce(
    (next, verdict, index) => deckReducer(next, { type: 'judge', optionId: deckCards(deck())[index]!.id, verdict }),
    state,
  );
}

describe('deckReducer', () => {
  it('records a like and leaves the reason sheet closed', () => {
    const state = deckReducer(initialDeck(), { type: 'judge', optionId: 'v1', verdict: 'like' });
    expect(state.cards).toEqual([{ optionId: 'v1', verdict: 'like' }]);
    expect(state.reason).toBeNull();
  });

  it('opens the reason sheet on a dislike in the same tap', () => {
    const state = deckReducer(initialDeck(), { type: 'judge', optionId: 'v2', verdict: 'dislike' });
    expect(state.cards).toEqual([{ optionId: 'v2', verdict: 'dislike' }]);
    expect(state.reason).toEqual({ optionId: 'v2', text: '' });
  });

  it('keeps the reason the creator typed when the sheet closes and drops a blank one', () => {
    let state = deckReducer(initialDeck(), { type: 'judge', optionId: 'v2', verdict: 'dislike' });
    state = deckReducer(state, { type: 'set-reason', text: '  too robotic  ' });
    state = deckReducer(state, { type: 'close-reason' });
    expect(state.cards).toEqual([{ optionId: 'v2', verdict: 'dislike', reason: 'too robotic' }]);

    let blank = deckReducer(initialDeck(), { type: 'judge', optionId: 'v3', verdict: 'dislike' });
    blank = deckReducer(blank, { type: 'set-reason', text: '   ' });
    blank = deckReducer(blank, { type: 'close-reason' });
    expect(blank.cards).toEqual([{ optionId: 'v3', verdict: 'dislike' }]);
  });

  it('undoes the last swipe and its reason', () => {
    let state = deckReducer(initialDeck(), { type: 'judge', optionId: 'v1', verdict: 'like' });
    state = deckReducer(state, { type: 'judge', optionId: 'v2', verdict: 'dislike' });
    state = deckReducer(state, { type: 'set-reason', text: 'too robotic' });
    state = deckReducer(state, { type: 'undo' });
    expect(state.cards).toEqual([{ optionId: 'v1', verdict: 'like' }]);
    expect(state.reason).toBeNull();
  });

  it('flips a card between like and dislike and clears its reason', () => {
    let state = deckReducer(initialDeck(), { type: 'judge', optionId: 'v2', verdict: 'dislike' });
    state = deckReducer(state, { type: 'set-reason', text: 'too robotic' });
    state = deckReducer(state, { type: 'close-reason' });
    state = deckReducer(state, { type: 'flip', optionId: 'v2' });
    expect(state.cards).toEqual([{ optionId: 'v2', verdict: 'like' }]);
    expect(state.picked).toBeNull();
  });

  it('ignores a second judgement of the same card', () => {
    const once = deckReducer(initialDeck(), { type: 'judge', optionId: 'v1', verdict: 'like' });
    const twice = deckReducer(once, { type: 'judge', optionId: 'v1', verdict: 'dislike' });
    expect(twice).toBe(once);
  });

  it('reopens a dislike reason for editing', () => {
    let state = deckReducer(initialDeck(), { type: 'judge', optionId: 'v2', verdict: 'dislike' });
    state = deckReducer(state, { type: 'set-reason', text: 'too robotic' });
    state = deckReducer(state, { type: 'close-reason' });
    state = deckReducer(state, { type: 'open-reason', optionId: 'v2' });
    expect(state.reason).toEqual({ optionId: 'v2', text: 'too robotic' });
  });

  it('keeps the whole-set notes the creator typed', () => {
    const state = deckReducer(initialDeck(), { type: 'set-notes', text: 'All too young for the Blobs.' });
    expect(state.notes).toBe('All too young for the Blobs.');
  });
});

describe('deck state readings', () => {
  it('finishes when every card has a verdict', () => {
    let state = initialDeck();
    expect(deckFinished(deck(), state)).toBe(false);
    state = judge(state, 'like', 'dislike', 'like');
    expect(deckFinished(deck(), state)).toBe(true);
  });

  it('reads the shortlist as the liked cards in the order they were judged', () => {
    const state = judge(initialDeck(), 'dislike', 'like', 'like');
    expect(shortlist(state)).toEqual(['v2', 'v3']);
  });

  it('carries the likes and dislikes, with reasons only where the creator gave one', () => {
    let state = judge(initialDeck(), 'like', 'dislike');
    state = deckReducer(state, { type: 'set-reason', text: 'too robotic' });
    state = deckReducer(state, { type: 'close-reason' });
    state = deckReducer(state, { type: 'judge', optionId: 'v3', verdict: 'dislike' });
    state = deckReducer(state, { type: 'close-reason' });
    expect(reviewOf(state)).toEqual({
      likes: ['v1'],
      dislikes: [{ option_id: 'v2', reason: 'too robotic' }, { option_id: 'v3' }],
    });
  });

  // The whole-set note is the creator's words about every card, so it travels beside the per-card votes and only when
  // they wrote something.
  it('carries the whole-set notes beside the per-card votes, and leaves them out when blank', () => {
    let state = judge(initialDeck(), 'like', 'dislike', 'like');
    expect(reviewOf(state).notes).toBeUndefined();

    state = deckReducer(state, { type: 'set-notes', text: '   ' });
    expect(reviewOf(state).notes).toBeUndefined();

    state = deckReducer(state, { type: 'set-notes', text: '  All too young for the Blobs.  ' });
    expect(reviewOf(state).notes).toBe('All too young for the Blobs.');
  });

  it('answers with the tapped shortlist card when the Command asks for one pick', () => {
    const command = deck({ pick: 'one' });
    let state = judge(initialDeck(), 'like', 'like', 'like');
    state = deckReducer(state, { type: 'pick', optionId: 'v2' });
    expect(answerOf(command, state).option_id).toBe('v2');
  });

  it('answers a one-pick Command with the first like when the creator picked nothing', () => {
    const command = deck({ pick: 'one', recommend: 'v3' });
    const state = judge(initialDeck(), 'dislike', 'like', 'dislike');
    expect(answerOf(command, state).option_id).toBe('v2');
  });

  it('answers a many-pick Command with the likes and dislikes as the map', () => {
    const command = deck({ pick: 'many' });
    const state = judge(initialDeck(), 'like', 'dislike', 'like');
    expect(answerOf(command, state)).toEqual({
      option_id: 'v1',
      review: { likes: ['v1', 'v3'], dislikes: [{ option_id: 'v2' }] },
    });
  });

  it('falls back to the recommendation when the creator liked nothing', () => {
    const command = deck({ pick: 'many', recommend: 'v3' });
    const state = judge(initialDeck(), 'dislike', 'dislike', 'dislike');
    expect(answerOf(command, state).option_id).toBe('v3');
  });

  it('tells a clip from a sample from a still', () => {
    expect(
      mediaKindOf({
        url: 'https://media.example.test/a.mp4',
        width: 1,
        height: 1,
        poster: 'https://media.example.test/a.jpg',
      }),
    ).toBe('video');
    expect(mediaKindOf({ url: 'https://media.example.test/a.wav', width: 1, height: 1, duration_ms: 1200 })).toBe(
      'audio',
    );
    expect(mediaKindOf({ url: 'https://media.example.test/a.gif', width: 1, height: 1 })).toBe('image');
  });

  // An aiur Command's clip often has no servable poster, and it still has a duration: without its named kind it would
  // be played as an audio sample with no picture (#611).
  it('trusts the kind a card names over its poster and duration', () => {
    expect(
      mediaKindOf({ url: 'https://media.example.test/a.mp4', width: 1, height: 1, duration_ms: 1200, kind: 'video' }),
    ).toBe('video');
  });

  // Audio cards show how long the sample runs, so a long take can be judged without playing all of it.
  it('shows an audio sample’s length as minutes and seconds', () => {
    expect(clipLength(0)).toBe('0:00');
    expect(clipLength(2400)).toBe('0:02');
    expect(clipLength(59_400)).toBe('0:59');
    expect(clipLength(72_000)).toBe('1:12');
    expect(clipLength(600_000)).toBe('10:00');
  });
});
