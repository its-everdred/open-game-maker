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
    expect(games.find((game) => game.title === 'Mossy Leap')?.showcase?.id).toBe('mossy-leap');
    expect(games.find((game) => game.title === 'Puddle Postal')).toBeDefined();
    expect(games.find((game) => game.title === 'Blobs VS Blocks')?.id).toBe('blobs');
  });

  it('shows the real RestoreBound as itself, not under the old placeholder record', () => {
    // RestoreBound began as an invented showcase tile; the family's real game now owns the slug.
    const games = mergeShowcase([real('real-restorebound', 'RestoreBound', 'restorebound')]);
    const restorebound = games.filter((game) => game.slug === 'restorebound' || game.title === 'RestoreBound');
    expect(restorebound).toHaveLength(1);
    expect(restorebound[0]?.id).toBe('real-restorebound');
    expect(restorebound[0]?.showcase).toBeUndefined();
    expect(mergeShowcase([]).find((game) => game.id === 'showcase:restorebound')).toBeUndefined();
  });
});
