import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Ambient } from './Ambient';
import { mergeShowcase } from './showcase';
import type { GameSummary } from './types';

const game: GameSummary = {
  id: 'game',
  familyId: 'family',
  ownerId: 'owner',
  title: 'Game',
  repo: null,
  createdAt: '',
};

describe('Ambient', () => {
  it('uses the trailer when no cover exists', () => {
    const { container } = render(<Ambient game={{ ...game, trailerUrl: '/trailer.mp4' }} />);
    expect(container.querySelector('video')).toHaveAttribute('src', '/trailer.mp4');
    expect(container.querySelector('video')?.muted).toBe(true);
  });

  it('prefers a real trailer to showcase art when a game has no cover', () => {
    const realGame = { ...game, slug: 'goblin-cellar', trailerUrl: '/trailer.mp4' };
    const merged = mergeShowcase([realGame]).find((item) => item.id === realGame.id)!;
    const { container } = render(<Ambient game={merged} />);
    expect(container.querySelector('video')).toHaveAttribute('src', '/trailer.mp4');
  });
});
