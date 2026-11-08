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
  // The shortlist card the creator picked, when the Command asks for one pick.
  picked: string | null;
  // Anything the creator wants to say about the set as a whole, beside the per-card votes. Optional: an empty field
  // sends no notes at all.
  notes: string;
  sending: boolean;
};

export type DeckAction =
  | { type: 'judge'; optionId: string; verdict: ReviewVerdict }
  | { type: 'undo' }
  | { type: 'open-reason'; optionId: string }
  | { type: 'set-reason'; text: string }
  | { type: 'close-reason' }
  | { type: 'set-notes'; text: string }
  | { type: 'flip'; optionId: string }
  | { type: 'pick'; optionId: string }
  | { type: 'sending' }
  | { type: 'sent' };

export function initialDeck(): DeckState {
  return { cards: [], reason: null, picked: null, notes: '', sending: false };
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
      const cards = state.cards.slice(0, -1);
      const dropped = state.cards.at(-1)!;
      const picked = state.picked === dropped.optionId ? null : state.picked;
      return { ...state, cards, reason: null, picked };
    }
    case 'open-reason': {
      const card = state.cards.find(({ optionId }) => optionId === action.optionId);
      if (card === undefined || card.verdict !== 'dislike') return state;
      return { ...state, reason: { optionId: action.optionId, text: card.reason ?? '' } };
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
    case 'flip': {
      const cards = state.cards.map((card) =>
        card.optionId === action.optionId
          ? { ...card, verdict: card.verdict === 'like' ? ('dislike' as const) : ('like' as const), reason: undefined }
          : card,
      );
      const flipped = cards.find(({ optionId }) => optionId === action.optionId);
      const picked = flipped?.verdict === 'dislike' && state.picked === action.optionId ? null : state.picked;
      return { ...state, cards, picked };
    }
    case 'pick':
      return { ...state, picked: action.optionId };
    case 'set-notes':
      return { ...state, notes: action.text };
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

// The like/dislike map the answer carries. A dislike's reason travels only when the creator gave one, and the
// whole-set notes travel only when the creator wrote any.
export function reviewOf(state: DeckState): CommandReview {
  const notes = state.notes.trim();
  return {
    likes: state.cards.filter(({ verdict }) => verdict === 'like').map(({ optionId }) => optionId),
    dislikes: state.cards.flatMap((card) =>
      card.verdict === 'dislike'
        ? [{ option_id: card.optionId, ...(card.reason === undefined ? {} : { reason: card.reason }) }]
        : [],
    ),
    ...(notes === '' ? {} : { notes }),
  };
}

// The answer's option id: the shortlist card the creator picked when the Command asks for one, otherwise the first
// like in the order they judged (the recommendation, or the first card, when they liked nothing).
export function answerOf(command: GameCommand, state: DeckState): { option_id: string; review: CommandReview } {
  const review = reviewOf(state);
  const option_id =
    command.pick === 'many'
      ? (review.likes[0] ?? command.recommend ?? command.options[0]!.id)
      : (state.picked ?? review.likes[0] ?? command.recommend ?? command.options[0]!.id);
  return { option_id, review };
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
