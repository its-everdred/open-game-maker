import { beforeEach, describe, expect, it } from 'vitest';
import { readGames, saveGames } from './gamesCache';
import type { GameSummary } from './types';

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
});
