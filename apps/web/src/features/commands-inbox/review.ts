import type { CommandOption, CommandReview, GameCommand, OptionPlayable } from '@ogm/contracts';

// A review deck (A3): a Command whose options carry media is judged one card at a time. The deck's state is the order
// the creator walked the cards in, so undo means "take the last judgement back" and the ending grid is the same list.
export type ReviewVerdict = 'like' | 'dislike';

export type DeckCard = { optionId: string; verdict: ReviewVerdict; reason?: string };

export type DeckState = {
  // The cards judged so far, oldest first. The card on screen is `command.options[cards.length]`.
  cards: DeckCard[];
  // The dislike whose reason sheet is open, with the words typed so far.
  reason: { optionId: string; text: string } | null;
  sending: boolean;
};

export type DeckAction =
  | { type: 'judge'; optionId: string; verdict: ReviewVerdict }
  | { type: 'undo' }
  | { type: 'set-reason'; text: string }
  | { type: 'close-reason' }
  | { type: 'sending' }
  | { type: 'sent' };

export function initialDeck(): DeckState {
  return { cards: [], reason: null, sending: false };
}

// A dislike opens its reason sheet in the same tap that records the verdict, so the creator can explain it without
// leaving the deck. Skipping the sheet leaves the dislike as a plain swipe.
export function deckReducer(state: DeckState, action: DeckAction): DeckState {
  switch (action.type) {
    case 'judge': {
      if (state.cards.some(({ optionId }) => optionId === action.optionId)) return state;
      const card: DeckCard = { optionId: action.optionId, verdict: action.verdict };
      return {
        ...state,
        cards: [...state.cards, card],
        reason: action.verdict === 'dislike' ? { optionId: action.optionId, text: '' } : null,
      };
    }
    case 'undo': {
      if (state.cards.length === 0) return state;
      return { ...state, cards: state.cards.slice(0, -1), reason: null };
    }
    case 'set-reason':
      return state.reason === null ? state : { ...state, reason: { ...state.reason, text: action.text } };
    case 'close-reason': {
      if (state.reason === null) return state;
      const text = state.reason.text.trim();
      const cards = state.cards.map((card) =>
        card.optionId === state.reason!.optionId
          ? { ...card, ...(text === '' ? { reason: undefined } : { reason: text }) }
          : card,
      );
      return { ...state, cards, reason: null };
    }
    case 'sending':
      return { ...state, sending: true };
    case 'sent':
      return { ...state, sending: false };
  }
}

// The Command's cards, in the order the deck shows them.
export function deckCards(command: GameCommand): GameCommand['options'] {
  return command.options;
}

// A card's short label: A, B, C… in the deck's order, so the cards carry letters instead of sentences.
export function letterOf(cards: GameCommand['options'], optionId: string): string {
  const index = cards.findIndex(({ id }) => id === optionId);
  if (index < 0) return optionId;
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

// Whether the creator has judged every card.
export function deckFinished(command: GameCommand, state: DeckState): boolean {
  return state.cards.length >= deckCards(command).length;
}

// The shortlist of likes a one-pick Command chooses from.
export function shortlist(state: DeckState): string[] {
  return state.cards.filter(({ verdict }) => verdict === 'like').map(({ optionId }) => optionId);
}

// The like/dislike map the answer carries. A dislike's reason travels only when the creator gave one.
export function reviewOf(state: DeckState): CommandReview {
  return {
    likes: state.cards.filter(({ verdict }) => verdict === 'like').map(({ optionId }) => optionId),
    dislikes: state.cards.flatMap((card) =>
      card.verdict === 'dislike'
        ? [{ option_id: card.optionId, ...(card.reason === undefined ? {} : { reason: card.reason }) }]
        : [],
    ),
  };
}

// The answer's option id: the first like in the order the creator judged (the recommendation, or the first card, when
// they liked nothing). The whole map travels beside it, and is the answer itself for a Command no job owns.
export function answerOf(command: GameCommand, state: DeckState): { option_id: string; review: CommandReview } {
  const review = reviewOf(state);
  return { option_id: review.likes[0] ?? command.recommend ?? command.options[0]!.id, review };
}

// A card's media tells the deck how to render it: its `kind` when it names one, else a clip carries a poster, an audio
// sample carries a duration without one, and a still or GIF carries neither.
export function mediaKindOf(media: NonNullable<CommandOption['media']>): 'audio' | 'video' | 'image' {
  if (media.kind !== undefined) return media.kind;
  if (media.poster !== undefined) return 'video';
  if (media.duration_ms !== undefined) return 'audio';
  return 'image';
}

// How long an audio sample runs, as its card shows it: `0:04`, or `1:12` past a minute. The creator judges a long take
// without playing all of it when the length is on the card.
export function clipLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// A link never shows as text in the deck: a URL in a title, question or label is dropped and the words around
// it kept. (`gm checkpoint open` keeps the question itself to one short line.)
const LINK = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi;

export function withoutLinks(text: string): string {
  return text.replace(LINK, '').replace(/\s+/g, ' ').trim();
}

// The query a playable slice boots the game with: the option's scenario plus its lead-in move, if it has one.
export function playableParams(playable: OptionPlayable): Record<string, string> {
  const params = Object.fromEntries(new URLSearchParams(playable.scenario));
  return playable.lead_in === undefined ? params : { ...params, lead_in: playable.lead_in };
}

// Compare mode plays every playable option in the Command's order, one slice after another; null once the last ends.
export function nextCompare(options: GameCommand['options'], current: number): number | null {
  for (let index = current + 1; index < options.length; index += 1) {
    if (options[index]!.playable !== undefined) return index;
  }
  return null;
}
