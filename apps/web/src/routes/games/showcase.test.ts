import { describe, expect, it } from 'vitest';
import { mergeShowcase } from './showcase';
import type { GameSummary } from './types';

const real = (id: string, title: string, slug: string): GameSummary => ({
  id,
  title,
  slug,
  familyId: 'family',
  ownerId: 'owner',
  repo: null,
  createdAt: '2026-01-01T00:00:00Z',
});

describe('prototype showcase', () => {
  it('keeps the real Goblin Cellar and other real games while including all prototype entries', () => {
    const games = mergeShowcase([
      real('real-goblin', 'Goblin Cellar', 'goblin-cellar'),
      real('blobs', 'Blobs VS Blocks', 'blobs'),
    ]);
    expect(games.filter((game) => game.title === 'Goblin Cellar')).toHaveLength(1);
    expect(games.find((game) => game.title === 'Goblin Cellar')?.id).toBe('real-goblin');
    expect(games.find((game) => game.title === 'RestoreBound')?.showcase?.badge).toBe('Featured');
    expect(games.find((game) => game.title === 'Puddle Postal')).toBeDefined();
    expect(games.find((game) => game.title === 'Blobs VS Blocks')?.id).toBe('blobs');
  });
});
