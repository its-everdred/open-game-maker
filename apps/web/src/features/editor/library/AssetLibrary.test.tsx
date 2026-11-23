import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditorLibrary } from '@ogm/contracts/browser';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api/client', () => ({ api }));

import { AssetLibrary } from './AssetLibrary';

const fences = Array.from({ length: 400 }, (_, n) => ({
  id: `t1:rural/tiles/fence-${n}@1`,
  label: `Fence ${n}`,
  group: 'fences',
  tag: 'Fence',
  pack: 'rural',
}));
const library: EditorLibrary = {
  set: 'smallscaleint',
  groups: [
    { id: 'fences', label: 'Fences' },
    { id: 'nature', label: 'Nature' },
  ],
  packs: [{ id: 'rural', label: 'Zombie Rural' }],
  items: [...fences, { id: 't1:rural/tiles/tree-a1@1', label: 'Tree A1', group: 'nature', tag: 'Tree', pack: 'rural' }],
};

/* jsdom lays nothing out: give the grid a phone-sized viewport and the game a box. */
const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }) as DOMRect;
const sizes = { clientWidth: 366, clientHeight: 300 };
beforeAll(() => {
  for (const [key, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
});
afterAll(() => {
  for (const key of Object.keys(sizes)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
});
beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue(library);
});
afterEach(cleanup);

/** `null`: the page has no editor to place into yet (no `onPlace`). */
async function renderLibrary(onPlace: ReturnType<typeof vi.fn> | null = vi.fn(), sheet = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <div className="game-stage">
        <div className="game-frame" />
        <AssetLibrary gameId="dusk-helm" onPlace={onPlace ?? undefined} />
      </div>
    </QueryClientProvider>,
  );
  if (sheet) await screen.findByRole('region', { name: 'Library' });
  await act(async () => {});
  document.querySelector('.game-frame')!.getBoundingClientRect = () => box(0, 0, 390, 844);
  return onPlace;
}

const item = (name: string) => screen.getByRole('button', { name });

describe('asset library', () => {
  it("reads the game's library and stays out of the page when it has nothing to offer", async () => {
    api.mockResolvedValue({ groups: [], packs: [], items: [] });
    await renderLibrary(vi.fn(), false);
    expect(api).toHaveBeenCalledWith('/games/dusk-helm/editor/library');
    expect(screen.queryByRole('region', { name: 'Library' })).toBeNull();
  });

  it('narrows to fences with one tap on the closed sheet, and shows only the rows in view', async () => {
    await renderLibrary();
    expect(screen.getByText('401')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fence 0' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fences' }));

    expect(screen.getByRole('button', { name: 'Fences' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('400')).toBeTruthy();
    expect(item('Fence 0')).toBeTruthy();
    /* 400 fences, 4 a row: a phone screenful plus overscan is in the page, never all of them. */
    expect(document.querySelectorAll('.asset-library-item').length).toBeLessThan(60);
    expect(screen.queryByRole('button', { name: 'Tree A1' })).toBeNull();
    expect(item('Fence 0').querySelector('img')!.getAttribute('src')).toBe(
      `/api/v1/games/dusk-helm/editor/library/thumb?card=${encodeURIComponent('t1:rural/tiles/fence-0@1')}`,
    );
  });

  it('on a phone, a tap arms a piece and tucks the sheet away; the next tap on the game places it there', async () => {
    const onPlace = await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Fences' }));

    fireEvent.pointerDown(item('Fence 3'), { pointerId: 1, pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(item('Fence 3'), { pointerId: 1, pointerType: 'touch', button: 0 });

    expect(screen.getByRole('button', { name: 'Library' }).getAttribute('aria-expanded')).toBe('false');
    const target = screen.getByRole('button', { name: 'Place Fence 3' });
    /* The arming tap's own click lands on the new target; it must not place a piece where the tile was. */
    fireEvent.click(target, { detail: 1, clientX: 60, clientY: 600 });
    expect(onPlace).not.toHaveBeenCalled();

    fireEvent.pointerDown(target, { pointerId: 2, pointerType: 'touch', button: 0 });
    fireEvent.click(target, { detail: 1, clientX: 120, clientY: 200 });
    expect(onPlace).toHaveBeenCalledWith('t1:rural/tiles/fence-3@1', { clientX: 120, clientY: 200 });
  });

  it('disarms with Escape or a second tap on the piece', async () => {
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Fences' }));
    const tapPiece = () => {
      fireEvent.pointerDown(item('Fence 3'), { pointerId: 1, pointerType: 'mouse', button: 0 });
      fireEvent.pointerUp(item('Fence 3'), { pointerId: 1, pointerType: 'mouse', button: 0 });
    };
    tapPiece();
    expect(screen.getByRole('button', { name: 'Place Fence 3' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Place Fence 3' })).toBeNull();

    tapPiece();
    tapPiece();
    expect(screen.queryByRole('button', { name: 'Place Fence 3' })).toBeNull();
  });

  it('never covers the game with a place target while the page has no editor to place into', async () => {
    await renderLibrary(null);
    fireEvent.click(screen.getByRole('button', { name: 'Fences' }));
    fireEvent.pointerDown(item('Fence 3'), { pointerId: 1, pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(item('Fence 3'), { pointerId: 1, pointerType: 'touch', button: 0 });

    expect(item('Fence 3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Place / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Library' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('brings later rows into the page as the grid scrolls', async () => {
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Fences' }));
    const grid = document.querySelector<HTMLElement>('.asset-library-grid')!;
    grid.scrollTop = 4000;
    fireEvent.scroll(grid);

    expect(screen.queryByRole('button', { name: 'Fence 0' })).toBeNull();
    const shown = [...document.querySelectorAll('.asset-library-item')].map((node) => node.getAttribute('aria-label'));
    expect(shown.length).toBeLessThan(60);
    expect(shown.some((label) => Number(label!.split(' ')[1]) > 100)).toBe(true);
  });

  it('with a mouse, dragging a piece onto the game places it where it is let go, but not when let go on the sheet', async () => {
    const onPlace = await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Fences' }));
    document.querySelector('.asset-library')!.getBoundingClientRect = () => box(0, 500, 390, 344);
    const drag = (to: { clientX: number; clientY: number }) => {
      const piece = item('Fence 1');
      fireEvent.pointerDown(piece, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 100, clientY: 600 });
      fireEvent.pointerMove(piece, { pointerId: 2, pointerType: 'mouse', ...to });
      fireEvent.pointerUp(piece, { pointerId: 2, pointerType: 'mouse', button: 0, ...to });
    };

    drag({ clientX: 100, clientY: 700 });
    expect(onPlace).not.toHaveBeenCalled();
    expect(document.querySelector('.asset-library-ghost')).toBeNull();

    drag({ clientX: 180, clientY: 260 });
    expect(onPlace).toHaveBeenCalledWith('t1:rural/tiles/fence-1@1', { clientX: 180, clientY: 260 });
    /* A drag is not a tap: nothing stays armed. */
    expect(screen.queryByRole('button', { name: /^Place / })).toBeNull();
  });
});
