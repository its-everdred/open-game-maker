import { beforeEach, describe, expect, it } from 'vitest';
import { preloadGames, readGames, saveGames } from './gamesCache';
import type { DisplayImage, GameSummary } from './types';

const games: GameSummary[] = [
  { id: 'game', familyId: 'family', ownerId: 'owner', title: 'Game', repo: null, createdAt: '' },
];

describe('games cache', () => {
  beforeEach(() => localStorage.clear());

  it('restores the last list only for the same signed-in user', () => {
    saveGames('one', games);
    expect(readGames('one')).toEqual(games);
    expect(readGames('two')).toBeUndefined();
    expect(readGames(undefined)).toBeUndefined();
  });

  it('ignores corrupt cached data', () => {
    localStorage.setItem('ogm.games.v1.one', '{');
    expect(readGames('one')).toBeUndefined();
    localStorage.setItem('ogm.games.v1.one', '[null]');
    expect(readGames('one')).toBeUndefined();
    localStorage.setItem('ogm.games.v1.one', JSON.stringify([{ ...games[0], coverImage: { sources: {} } }]));
    expect(readGames('one')).toBeUndefined();
    localStorage.setItem('ogm.games.v1.one', JSON.stringify([{ ...games[0], showcase: {} }]));
    expect(readGames('one')).toBeUndefined();
    localStorage.setItem('ogm.games.v1.one', JSON.stringify([{ ...games[0], stats: { version: {} } }]));
    expect(readGames('one')).toBeUndefined();
  });

  it('round trips and rejects malformed slot image variants', () => {
    const image: DisplayImage = {
      width: 390,
      height: 844,
      sources: {
        avif: [{ width: 390, path: '/avif.png' }],
        webp: [{ width: 390, path: '/webp.png' }],
        png: [{ width: 390, path: '/png.png' }],
      },
    };
    const withSlots = [{ ...games[0]!, slotImages: { tile: { 'phone-portrait': image } } }];
    saveGames('one', withSlots);
    expect(readGames('one')).toEqual(withSlots);
    localStorage.setItem('ogm.games.v1.one', JSON.stringify([{ ...games[0], slotImages: { tile: { mobile: image } } }]));
    expect(readGames('one')).toBeUndefined();
    localStorage.setItem(
      'ogm.games.v1.one',
      JSON.stringify([{ ...games[0], slotImages: { tile: { 'phone-portrait': { ...image, sources: {} } } } }]),
    );
    expect(readGames('one')).toBeUndefined();
  });

  it('preloads each tile variant only for its viewport', () => {
    const image = (path: string): DisplayImage => ({
      width: 390,
      height: 844,
      sources: {
        avif: [{ width: 390, path: `${path}.avif` }],
        webp: [{ width: 390, path: `${path}.webp` }],
        png: [{ width: 390, path: `${path}.png` }],
      },
    });
    saveGames('one', [
      {
        ...games[0]!,
        coverUrl: '/original.png',
        slotImages: {
          tile: {
            'phone-portrait': image('/phone-portrait'),
            'phone-landscape': image('/phone-landscape'),
            'tablet-portrait': image('/tablet-portrait'),
            'tablet-landscape': image('/tablet-landscape'),
            desktop: image('/desktop'),
          },
        },
      },
    ]);
    preloadGames('one');
    const expectedPreloads = [
      ['/phone-portrait.avif 390w', '(max-width: 600px) and (orientation: portrait)'],
      ['/phone-landscape.avif 390w', '(max-width: 1000px) and (orientation: landscape)'],
      ['/tablet-portrait.avif 390w', '(min-width: 601px) and (max-width: 1000px) and (orientation: portrait)'],
      ['/tablet-landscape.avif 390w', '(min-width: 1001px) and (max-width: 1439px) and (orientation: landscape)'],
      ['/desktop.avif 390w', '(min-width: 1440px)'],
    ];
    for (const [srcSet, media] of expectedPreloads) {
      const link = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][media]')].find(
        (entry) => entry.media === media,
      );
      expect(link).toHaveAttribute('imagesrcset', srcSet);
    }
    expect(document.head.querySelectorAll('link[rel="preload"][media]')).toHaveLength(5);

    saveGames('two', [{ ...games[0]!, coverUrl: '/fallback.png' }]);
    preloadGames('two');
    expect(document.head.querySelector('link[rel="preload"][href="/fallback.png"]')).toBeInTheDocument();
  });
});
