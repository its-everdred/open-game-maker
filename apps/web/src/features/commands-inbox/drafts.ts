import { useCallback } from 'react';
import { create } from 'zustand';

import type { GameCommand } from '@ogm/contracts';

import { deckReducer, initialDeck, type DeckAction, type DeckState } from './review';

// Every review's answer stays a draft until the creator sends it. Moving to the next question, back to the rows
// or out to the game keeps each deck's votes, reasons and notes, so the drafts live outside the deck that edits them.
// A Command reopened at a new version is a new question: its key carries the version, so an old draft never answers
// it.
export type ReviewDraft = { deck: DeckState; sent: boolean };

type DraftStore = { drafts: Record<string, ReviewDraft> };

const useDraftStore = create<DraftStore>()(() => ({ drafts: {} }));

const EMPTY: ReviewDraft = { deck: initialDeck(), sent: false };

export function draftKey(command: Pick<GameCommand, 'checkpoint_id' | 'version'>): string {
  return `${command.checkpoint_id}:${command.version}`;
}

export function useReviewDraft(command: GameCommand): ReviewDraft {
  return useDraftStore((store) => store.drafts[draftKey(command)] ?? EMPTY);
}

// The deck's reducer, run on the stored draft: the same actions the deck dispatched before drafts outlived it.
export function useDeckDraft(command: GameCommand): [DeckState, (action: DeckAction) => void] {
  const key = draftKey(command);
  const { deck } = useReviewDraft(command);
  const dispatch = useCallback(
    (action: DeckAction) =>
      useDraftStore.setState((store) => {
        const draft = store.drafts[key] ?? EMPTY;
        return { drafts: { ...store.drafts, [key]: { ...draft, deck: deckReducer(draft.deck, action) } } };
      }),
    [key],
  );
  return [deck, dispatch];
}

// Whether this question's answer already went out: the screen then shows it as sent instead of a deck to send again.
export function useIsSent(command: GameCommand | undefined): boolean {
  return useDraftStore((store) => (command === undefined ? false : (store.drafts[draftKey(command)]?.sent ?? false)));
}

export function markSent(command: GameCommand): void {
  const key = draftKey(command);
  useDraftStore.setState((store) => ({
    drafts: { ...store.drafts, [key]: { ...(store.drafts[key] ?? EMPTY), sent: true } },
  }));
}

// Changing a saved answer: the question opens again as an untouched deck, not the votes already sent.
export function reopenDraft(command: GameCommand): void {
  const key = draftKey(command);
  useDraftStore.setState((store) => ({ drafts: { ...store.drafts, [key]: EMPTY } }));
}

// A row's state in the inbox: untouched, started (some cards judged or notes written) or sent.
export function draftState(draft: ReviewDraft): 'open' | 'draft' | 'sent' {
  if (draft.sent) return 'sent';
  return draft.deck.cards.length > 0 || draft.deck.notes.trim() !== '' ? 'draft' : 'open';
}

// Drafts are the signed-in creator's own: signing out clears them so the next person on the device starts clean.
export function resetReviewDrafts(): void {
  useDraftStore.setState({ drafts: {} });
}
