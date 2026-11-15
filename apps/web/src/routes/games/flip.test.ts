import { afterEach, describe, expect, it, vi } from 'vitest';

import { glideCover, glideTiles, type TileRects } from './flip';

afterEach(() => vi.unstubAllGlobals());

describe('glideTiles', () => {
  it('animates position and size changes in both directions', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const tile = document.createElement('div');
    tile.dataset.gameId = 'g_1';
    tile.animate = vi.fn();
    tile.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 20, bottom: 220, width: 400, height: 200 }) as DOMRect);
    const container = document.createElement('div');
    container.append(tile);
    glideTiles(container, new Map([['g_1', { left: 100, top: 30, width: 200, height: 100 } as DOMRect]]));
    expect(tile.animate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ transform: 'translate(100px, 10px) scale(0.5, 0.5)' })]),
      expect.objectContaining({ duration: 300 }),
    );
  });

  it('fades incoming details only on phone', () => {
    let phone = true;
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: phone && query === '(max-width: 600px)' })),
    );
    const container = document.createElement('div');
    container.innerHTML =
      '<div data-game-id="g_1" class="is-selected"><div class="game-cell-spotlight"><div class="games-spotlight-copy"></div></div></div>';
    const cell = container.firstElementChild as HTMLElement;
    const copy = container.querySelector<HTMLElement>('.games-spotlight-copy')!;
    cell.animate = vi.fn();
    copy.animate = vi.fn();
    cell.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, bottom: 600, width: 390, height: 600 }) as DOMRect);
    glideTiles(container, new Map([['g_1', { left: 0, top: 0, width: 390, height: 220 } as DOMRect]]));
    expect(cell.animate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ transform: 'translate(0px, 0px) scale(1, 1)' })]),
      expect.anything(),
    );
    expect(copy.animate).toHaveBeenCalledWith(
      [{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }],
      expect.objectContaining({ duration: 300 }),
    );
    vi.mocked(copy.animate).mockClear();
    phone = false;
    glideTiles(container, new Map([['g_1', { left: 0, top: 0, width: 390, height: 220 } as DOMRect]]));
    expect(copy.animate).not.toHaveBeenCalled();
    phone = true;
    cell.classList.remove('is-selected');
    vi.mocked(cell.animate).mockClear();
    cell.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, bottom: 220, width: 390, height: 220 }) as DOMRect);
    glideTiles(container, new Map([['g_1', { left: 0, top: 0, width: 390, height: 600 } as DOMRect]]));
    expect(cell.animate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ transform: `translate(0px, 0px) scale(1, ${600 / 220})` })]),
      expect.anything(),
    );
    expect(copy.animate).not.toHaveBeenCalled();
  });

  it('keeps the cover at its old rectangle while its cell expands', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const container = document.createElement('div');
    container.innerHTML = '<div data-game-id="g_1"><span class="game-cover-host"></span></div>';
    const cell = container.firstElementChild as HTMLElement;
    const host = cell.firstElementChild as HTMLElement;
    cell.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect);
    host.getBoundingClientRect = vi.fn(() => ({ left: 200, top: 0, width: 200, height: 200 }) as DOMRect);
    host.animate = vi.fn();
    const before = new Map([['g_1', { left: 100, top: 0, width: 200, height: 200 } as DOMRect]]);
    glideCover(container, before, { id: 'g_1', rect: { left: 100, top: 0, width: 200, height: 200 } as DOMRect });
    expect(host.animate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ transform: 'translate(-200px, 0px) scale(2, 2)' })]),
      expect.objectContaining({ duration: 300 }),
    );
  });

  it('preserves the old cover rectangle when phone cells do not scale', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(max-width: 600px)' })),
    );
    const container = document.createElement('div');
    container.innerHTML = '<div data-game-id="g_1" class="is-selected"><span class="game-cover-host"></span></div>';
    const cell = container.firstElementChild as HTMLElement;
    const host = cell.firstElementChild as HTMLElement;
    cell.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 390, height: 600 }) as DOMRect);
    host.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 60, width: 390, height: 220 }) as DOMRect);
    host.animate = vi.fn();
    glideCover(container, new Map([['g_1', { left: 0, top: 0, width: 390, height: 220 } as DOMRect]]), {
      id: 'g_1',
      rect: { left: 0, top: 0, width: 390, height: 220 } as DOMRect,
    });
    expect(host.animate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ transform: 'translate(0px, -60px) scale(1, 1)' })]),
      expect.anything(),
    );
  });

  it('unclips a masked spotlight while its cover moves', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const container = document.createElement('div');
    container.innerHTML =
      '<div data-game-id="g_1"><div class="games-spotlight-media"><span class="game-cover-host"></span></div></div>';
    const cell = container.firstElementChild as HTMLElement;
    const media = cell.firstElementChild as HTMLElement;
    const host = media.firstElementChild as HTMLElement;
    cell.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 400, height: 400 }) as DOMRect);
    host.getBoundingClientRect = vi.fn(() => ({ left: 200, top: 0, width: 200, height: 200 }) as DOMRect);
    media.animate = vi.fn();
    host.animate = vi.fn();
    glideCover(container, new Map([['g_1', { left: 100, top: 0, width: 200, height: 200 } as DOMRect]]), {
      id: 'g_1',
      rect: { left: 100, top: 0, width: 200, height: 200 } as DOMRect,
    });
    expect(media.animate).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ maskImage: 'none' })]),
      expect.anything(),
    );
  });

  it('leaves the mask alone when cover geometry has not changed', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const container = document.createElement('div');
    container.innerHTML =
      '<div data-game-id="g_1"><div class="games-spotlight-media"><span class="game-cover-host"></span></div></div>';
    const cell = container.firstElementChild as HTMLElement;
    const media = cell.firstElementChild as HTMLElement;
    const host = media.firstElementChild as HTMLElement;
    const rect = { left: 0, top: 0, width: 200, height: 200 } as DOMRect;
    cell.getBoundingClientRect = vi.fn(() => rect);
    host.getBoundingClientRect = vi.fn(() => rect);
    media.animate = vi.fn();
    host.animate = vi.fn();
    glideCover(container, new Map([['g_1', rect]]), { id: 'g_1', rect });
    expect(media.animate).not.toHaveBeenCalled();
    expect(host.animate).not.toHaveBeenCalled();
  });

  it('does not animate reordered tiles when reduced motion is requested', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const tile = document.createElement('div');
    tile.dataset.gameId = 'g_1';
    tile.animate = vi.fn();
    tile.getBoundingClientRect = vi.fn(() => ({ left: 20, top: 0, bottom: 100 }) as DOMRect);
    const container = document.createElement('div');
    container.append(tile);
    const before: TileRects = new Map([['g_1', { left: 0, top: 0 } as DOMRect]]);

    glideTiles(container, before);

    expect(tile.animate).not.toHaveBeenCalled();
  });
});
