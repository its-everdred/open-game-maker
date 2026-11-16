import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoadingLayer } from './LoadingLayer';

const game = { familyId: 'f_goblins', title: 'Goblin Cellar' };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LoadingLayer', () => {
  it('immediately exposes byte progress as a percentage', () => {
    vi.useFakeTimers();
    const view = render(<LoadingLayer game={game} load={{ phase: 'ready', loaded: 0, total: 100, done: false }} />);

    expect(view.container.querySelector('[role="progressbar"][aria-label="Loading"]')).toHaveAttribute(
      'aria-valuenow',
      '0',
    );

    view.rerender(<LoadingLayer game={game} load={{ phase: 'ready', loaded: 50, total: 100, done: false }} />);
    expect(view.container.querySelector('[role="progressbar"][aria-label="Loading"]')).toHaveAttribute(
      'aria-valuenow',
      '50',
    );

    view.rerender(<LoadingLayer game={game} load={{ phase: 'ready', loaded: 100, total: 100, done: false }} />);
    expect(view.container.querySelector('[role="progressbar"][aria-label="Loading"]')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });

  it('uses orientation-specific artwork and keeps the screen until the first frame', () => {
    vi.useFakeTimers();
    const gameWithArt = { ...game, loadingUrls: { portrait: '/p.png', landscape: '/l.png' } };
    const load = { phase: 'ready' as const, loaded: 100, total: 100, done: true };
    const view = render(<LoadingLayer game={gameWithArt} load={load} firstFrame={false} />);
    expect(view.container.querySelector('source')).toHaveAttribute('srcset', '/l.png');
    expect(view.container.querySelector('picture img')).toHaveAttribute('src', '/p.png');
    expect(view.container.querySelector('.game-loading-layer')).not.toHaveClass('is-done');
    view.rerender(<LoadingLayer game={gameWithArt} load={load} firstFrame />);
    act(() => vi.advanceTimersByTime(50));
    expect(view.container.querySelector('.game-loading-layer')).toHaveClass('is-done');
  });

  it('shows the game logo while loading', () => {
    const view = render(<LoadingLayer game={{ ...game, logoUrl: '/logo.png' }} />);
    expect(view.container.querySelector('.game-loading-logo')).toHaveAttribute('src', '/logo.png');
  });

  it('keeps the layer over the live game for its fade, then removes it', () => {
    vi.useFakeTimers();
    const view = render(<LoadingLayer game={game} load={{ phase: 'ready', loaded: 50, total: 100, done: false }} />);
    act(() => vi.advanceTimersByTime(150));

    view.rerender(
      <LoadingLayer game={game} load={{ phase: 'ready', loaded: 50, total: 100, done: true }} firstFrame />,
    );
    act(() => vi.advanceTimersByTime(50));
    expect(view.container.querySelector('[role="progressbar"]')?.closest('.game-loading-layer')).toHaveClass('is-done');

    act(() => vi.advanceTimersByTime(250));
    expect(view.container.querySelector('[role="progressbar"][aria-label="Loading"]')).toBeNull();
  });

  it('removes the layer without a fade when reduced motion is requested', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const view = render(<LoadingLayer game={game} load={{ phase: 'ready', loaded: 50, total: 100, done: false }} />);
    act(() => vi.advanceTimersByTime(150));

    view.rerender(
      <LoadingLayer game={game} load={{ phase: 'ready', loaded: 50, total: 100, done: true }} firstFrame />,
    );
    act(() => vi.advanceTimersByTime(50));

    expect(view.container.querySelector('[role="progressbar"][aria-label="Loading"]')).toBeNull();
  });
});
