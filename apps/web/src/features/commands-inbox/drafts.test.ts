import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameCommand } from '@ogm/contracts';

import { hydrateDrafts, resetReviewDrafts, saveDraft, useDeckDraft, useReviewDraft } from './drafts';
import { deckReducer, initialDeck, type DeckState } from './review';

// #631: each vote is saved on the server as it is cast. A save that fails must not leave the server behind for good,
// saves must land in the order they were cast, and votes coming back from the server must never overwrite a deck this
// tab already holds.

const command = { checkpoint_id: 'cp_1', version: 3 } as GameCommand;
const KEY_URL = '/api/v1/games/g_1/review-drafts/cp_1%3A3';

type Pending = { body: unknown; resolve: (response: Response) => void };
let pending: Pending[] = [];

function deckOf(...votes: Array<['v1' | 'v2' | 'v3', 'like' | 'dislike']>): DeckState {
  return votes.reduce(
    (deck, [optionId, verdict]) =>
      deckReducer(deckReducer(deck, { type: 'judge', optionId, verdict }), { type: 'close-reason' }),
    initialDeck(),
  );
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ok = () => new Response(null, { status: 204 });

beforeEach(() => {
  pending = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          expect(url).toBe(KEY_URL);
          pending.push({ body: JSON.parse(String(init.body)), resolve });
        }),
    ),
  );
});

afterEach(() => {
  resetReviewDrafts();
  vi.unstubAllGlobals();
});

describe('saving review drafts', () => {
  it('sends each save only after the one before it, in the order the votes were cast', async () => {
    saveDraft('g_1', command, deckOf(['v1', 'like']));
    saveDraft('g_1', command, deckOf(['v1', 'like'], ['v2', 'dislike']));
    await flush();

    expect(pending).toHaveLength(1);
    pending[0]!.resolve(ok());
    await flush();
    await flush();

    expect(pending).toHaveLength(2);
    expect(pending[1]!.body).toEqual({
      deck: {
        cards: [
          { option_id: 'v1', verdict: 'like' },
          { option_id: 'v2', verdict: 'dislike' },
        ],
      },
    });
  });

  it('sends the same deck again after a save failed', async () => {
    const deck = deckOf(['v1', 'like']);
    saveDraft('g_1', command, deck);
    await flush();
    pending[0]!.resolve(new Response(JSON.stringify({ error: 'down' }), { status: 503 }));
    await flush();
    await flush();

    saveDraft('g_1', command, deck);
    await flush();
    await flush();

    expect(pending).toHaveLength(2);
    expect(pending[1]!.body).toEqual(pending[0]!.body);
  });

  it('saves nothing when the deck has not changed since the last save', async () => {
    saveDraft('g_1', command, deckOf(['v1', 'like']));
    saveDraft('g_1', command, deckOf(['v1', 'like']));
    await flush();

    expect(pending).toHaveLength(1);
  });
});

describe('votes coming back from the server', () => {
  const serverDraft = [
    {
      key: 'cp_1:3',
      deck: { cards: [{ option_id: 'v1', verdict: 'like' as const }] },
      updated_at: '2026-11-08T10:00:00.000Z',
    },
  ];

  it('fill in a question this tab has not touched', () => {
    hydrateDrafts(serverDraft);

    const { result } = renderHook(() => useReviewDraft(command));
    expect(result.current.deck.cards).toEqual([{ optionId: 'v1', verdict: 'like' }]);
  });

  // A cached page is read again on every visit; a deck the creator undid back to nothing must stay empty.
  it('never bring back votes this tab undid', () => {
    hydrateDrafts(serverDraft);
    const { result } = renderHook(() => useDeckDraft(command));
    result.current[1]({ type: 'undo' });

    hydrateDrafts(serverDraft);

    const draft = renderHook(() => useReviewDraft(command)).result.current;
    expect(draft.deck.cards).toEqual([]);
  });
});
