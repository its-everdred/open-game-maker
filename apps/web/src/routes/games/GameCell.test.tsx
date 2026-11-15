import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GameCell } from './GameCell';
import type { GameSummary } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the settled spotlight size when a render occurs during expansion', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 150 } as DOMRect);
  const game = { id: 'g', title: 'Game', createdAt: '', ownerId: '', familyId: '', repo: null } as GameSummary;
  const tile = (
    <button>
      <span data-cover-slot />
    </button>
  );
  const spotlight = (
    <section>
      <span data-cover-slot />
    </section>
  );
  const view = render(<GameCell game={game} selected tile={tile} spotlight={spotlight} />);
  view.rerender(<GameCell game={game} selected tile={tile} spotlight={spotlight} />);
  view.rerender(<GameCell game={game} selected={false} tile={tile} spotlight={null} />);
  const exiting = view.container.querySelector<HTMLElement>('.game-cell-exiting');
  expect(exiting?.style.width).toBe('800px');
  expect(exiting?.style.height).toBe('600px');
});
