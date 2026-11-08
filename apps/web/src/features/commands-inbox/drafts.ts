import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

import type { GameCommand, ReviewDraftDeck, ReviewDraftsPage } from '@ogm/contracts';

import { api } from '../../lib/api/client';
import { deckReducer, initialDeck, type DeckAction, type DeckState } from './review';

// Every review's votes are a draft until the deck answers the Command. Moving to the next question, back to the rows
// or out to the game keeps each deck's votes and reasons, so the drafts live outside the deck that edits them, and each
// vote is saved on the server as it is cast (#631) so a reload or another device keeps them too.
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

// Whether this question's answer already went out: the screen then shows it as sent instead of a deck to answer again.
export function useIsSent(command: GameCommand | undefined): boolean {
  return useDraftStore((store) => (command === undefined ? false : (store.drafts[draftKey(command)]?.sent ?? false)));
}

export function markSent(command: GameCommand): void {
  const key = draftKey(command);
  useDraftStore.setState((store) => ({
    drafts: { ...store.drafts, [key]: { ...(store.drafts[key] ?? EMPTY), sent: true } },
  }));
}

// A row's state in the inbox: untouched, started (some cards judged) or sent.
export function draftState(draft: ReviewDraft): 'open' | 'draft' | 'sent' {
  if (draft.sent) return 'sent';
  return draft.deck.cards.length > 0 ? 'draft' : 'open';
}

// The part of a deck the server keeps: the votes and their reasons. An open reason sheet's words are saved once it
// closes onto the card.
function serverDeck(deck: DeckState): ReviewDraftDeck {
  return {
    cards: deck.cards.map(({ optionId, verdict, reason }) => ({
      option_id: optionId,
      verdict,
      ...(reason === undefined ? {} : { reason }),
    })),
  };
}

// What the server last holds for each draft, so a render that changed nothing saves nothing, and each draft's saves
// queued in order so an older vote never lands after a newer one.
const saved = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();

const draftsPath = (gameId: string) => `/games/${encodeURIComponent(gameId)}/review-drafts`;

export function saveDraft(gameId: string, command: GameCommand, deck: DeckState): void {
  const key = draftKey(command);
  const body = serverDeck(deck);
  const signature = JSON.stringify(body);
  if ((saved.get(key) ?? JSON.stringify(serverDeck(initialDeck()))) === signature) return;
  saved.set(key, signature);
  const queued = (queues.get(key) ?? Promise.resolve())
    .then(() => api(`${draftsPath(gameId)}/${encodeURIComponent(key)}`, { method: 'PUT', json: { deck: body } }))
    .catch(() => {
      // The vote stays in this tab's draft; the next vote saves the whole deck again.
      if (saved.get(key) === signature) saved.delete(key);
    });
  queues.set(key, queued);
}

// The server's drafts fill in any question this tab has not touched yet, so votes cast elsewhere come back. A question
// this tab already holds keeps its own state, even with every vote undone: it is newer, and already on its way to the
// server, and a cached page read again on the next visit must not bring old votes back.
export function hydrateDrafts(drafts: ReviewDraftsPage['drafts']): void {
  useDraftStore.setState((store) => {
    const next = { ...store.drafts };
    for (const { key, deck } of drafts) {
      if (next[key] !== undefined) continue;
      saved.set(key, JSON.stringify(deck));
      next[key] = {
        sent: false,
        deck: {
          ...initialDeck(),
          cards: deck.cards.map(({ option_id, verdict, reason }) => ({
            optionId: option_id,
            verdict,
            ...(reason === undefined ? {} : { reason }),
          })),
        },
      };
    }
    return { drafts: next };
  });
}

// Loads the signed-in creator's drafts for the game once per screen.
export function useServerDrafts(gameId: string): void {
  const { data } = useQuery({
    queryKey: ['review-drafts', gameId],
    queryFn: () => api<ReviewDraftsPage>(draftsPath(gameId)),
    retry: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (data !== undefined) hydrateDrafts(data.drafts);
  }, [data]);
}

// Drafts are the signed-in creator's own: signing out clears them so the next person on the device starts clean.
export function resetReviewDrafts(): void {
  useDraftStore.setState({ drafts: {} });
  saved.clear();
  queues.clear();
}
