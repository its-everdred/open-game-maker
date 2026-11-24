import { describe, expect, it } from 'vitest';

import { cardFailures, expectedParts, type CardPart } from '../src/qa-cards-check.js';

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
    expect(cardFailures([part({}), part({ part: 'cover' })], 30_000)).toEqual([]);
  });

  it('fails art that showed and then went away, and art that never showed', () => {
    expect(
      cardFailures(
        [part({ lostAt: 1_200, state: 'loading' }), part({ part: 'cover', shownAt: null, state: 'broken' })],
        30_000,
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
    expect(expectedParts(games)).toEqual(parts);
    expect(expectedParts({ games })).toEqual(parts);
    expect(() => expectedParts({ error: 'unauthenticated' })).toThrow('not a games list');
  });
});
