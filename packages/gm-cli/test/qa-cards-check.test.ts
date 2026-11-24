import { describe, expect, it } from 'vitest';

import { cardFailures, cardList, expectedParts, staleCards, type CardPart } from '../src/qa-cards-check.js';

const part = (over: Partial<CardPart>): CardPart => ({
  gameId: 'g_1',
  title: 'Dusk Helm',
  part: 'logo',
  shownAt: 400,
  lostAt: null,
  state: 'shown',
  ...over,
});

// 2026-11-23: Kevin's games list showed each logo, then blanked it while a new build's art loaded (#1312).
describe('cards check verdict', () => {
  it('passes art that showed and stayed', () => {
    expect(cardFailures([part({}), part({ part: 'cover' })], 30_000, 1)).toEqual([]);
  });

  it('fails art that showed and then went away, and art that never showed', () => {
    expect(
      cardFailures(
        [part({ lostAt: 1_200, state: 'loading' }), part({ part: 'cover', shownAt: null, state: 'broken' })],
        30_000,
        1,
      ),
    ).toEqual([
      'Dusk Helm logo: disappeared 1.2 s after it showed (loading)',
      'Dusk Helm cover: not shown within 30 s (broken)',
    ]);
  });

  it('expects a cover for each coverUrl and a logo for each logoUrl, from either list shape', () => {
    const games = [
      { id: 'g_1', title: 'Dusk Helm', coverUrl: 'https://g/c.png', logoUrl: 'https://g/l.png' },
      { id: 'g_2', title: 'Plain' },
      { id: 'g_3', title: 'Cover only', coverUrl: 'https://g/c3.png', logoUrl: null },
    ];
    const parts = [
      { gameId: 'g_1', title: 'Dusk Helm', part: 'cover' },
      { gameId: 'g_1', title: 'Dusk Helm', part: 'logo' },
      { gameId: 'g_3', title: 'Cover only', part: 'cover' },
    ];
    expect(expectedParts(cardList(games))).toEqual(parts);
    expect(expectedParts(cardList({ games }))).toEqual(parts);
    expect(() => cardList({ error: 'unauthenticated' })).toThrow('not a games list');
  });

  // A broken media join that drops every card's art would otherwise check nothing and pass.
  it('fails a list of games none of which declares art', () => {
    expect(cardFailures([], 30_000, 3)).toEqual(['none of the 3 games has a thumbnail or logo to check']);
    expect(cardFailures([], 30_000, 0)).toEqual([]);
  });

  it('serves the cached first visit with originals only, so the reload changes every card with variants', () => {
    const live = { id: 'g_1', coverUrl: '/c.png', coverImage: {}, logoUrl: '/l.png', logoImage: {}, slotImages: {} };
    expect(staleCards([live])).toEqual([{ id: 'g_1', coverUrl: '/c.png', logoUrl: '/l.png' }]);
  });
});
