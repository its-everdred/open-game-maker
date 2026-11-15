import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeShowcase } from './showcase';
import { GameTrailer } from './GameTrailer';
import { ShowcaseSpotlight } from './ShowcaseSpotlight';

afterEach(cleanup);

describe('showcase detail', () => {
  it('shows published media for a real showcase game', () => {
    const game = {
      ...mergeShowcase([])[0]!,
      coverUrl: '/thumbnail.png',
      trailerUrl: '/landscape.mp4',
      portraitTrailerUrl: '/portrait.mp4',
    };
    render(<ShowcaseSpotlight game={game} canOpen onPlay={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />);
    expect(document.querySelector('img[src="/thumbnail.png"]')).not.toBeNull();
    expect(document.querySelector('video.game-trailer-portrait')).toHaveAttribute('src', '/portrait.mp4');
    expect(document.querySelector('video.game-trailer-portrait')).toHaveAttribute('poster', '/thumbnail.png');
    expect(document.querySelector('video.game-trailer-landscape')).toHaveAttribute('src', '/landscape.mp4');
  });

  it('keeps trailer controls and a transparent poster when no cover image exists', () => {
    const game = { ...mergeShowcase([])[0]!, coverUrl: null, trailerUrl: '/landscape.mp4' };
    render(<GameTrailer game={game} transparentPoster />);
    const video = screen.getByLabelText(`${game.title} trailer`);
    expect(video).toHaveAttribute('controls');
    expect(video.getAttribute('poster')).toMatch(/^data:image\/svg\+xml,/);
    expect(video).toHaveAttribute('preload', 'none');
  });

  it('shows the prototype tags and stats and opens the selected action', () => {
    const game = mergeShowcase([]).find((entry) => entry.title === 'Goblin Cellar')!;
    const play = vi.fn();
    render(<ShowcaseSpotlight game={game} canOpen onPlay={play} onEdit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Dungeon')).toBeVisible();
    expect(screen.getByText('5h 25m')).toBeVisible();
    expect(screen.getByText('31.4k')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Play Goblin Cellar' }));
    expect(play).toHaveBeenCalledOnce();
  });
});
