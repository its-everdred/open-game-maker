import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeShowcase } from './showcase';
import { GameTrailer } from './GameTrailer';
import { ShowcaseSpotlight } from './ShowcaseSpotlight';

afterEach(cleanup);

describe('showcase detail', () => {
  it('uses a logo in place of the title', () => {
    const game = { ...mergeShowcase([])[0]!, logoUrl: '/logo.png' };
    const { container } = render(
      <ShowcaseSpotlight game={game} canOpen onPlay={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('region', { name: `${game.title} spotlight` })).toBeInTheDocument();
    expect(container.querySelector('img[src="/logo.png"]')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: game.title })).not.toBeInTheDocument();
  });

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

  it('uses the responsive cover beneath a shared trailer without loading the original poster', () => {
    const sources = Object.fromEntries(
      ['avif', 'webp', 'png'].map((format) => [
        format,
        [
          { width: 320, path: `/small.${format}` },
          { width: 640, path: `/large.${format}` },
        ],
      ]),
    );
    const game = {
      ...mergeShowcase([])[0]!,
      coverUrl: '/original.png',
      trailerUrl: '/trailer.mp4',
      coverImage: { width: 640, height: 360, sources },
    } as Parameters<typeof GameTrailer>[0]['game'];
    const { rerender } = render(<GameTrailer game={game} transparentPoster />);
    expect(screen.getByLabelText(`${game.title} trailer`).getAttribute('poster')).toMatch(/^data:image\/svg\+xml,/);
    rerender(<GameTrailer game={game} />);
    expect(screen.getByLabelText(`${game.title} trailer`)).toHaveAttribute('poster', '/large.webp');
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
