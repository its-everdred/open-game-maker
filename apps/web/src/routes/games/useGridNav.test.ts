import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useGridNav } from './useGridNav';

function key(name: string) {
  return { key: name, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe('useGridNav', () => {
  it('moves one tile horizontally and one measured row vertically', () => {
    const { result } = renderHook(() =>
      useGridNav({
        count: 7,
        selectedIndex: null,
        columns: () => 3,
        onSelect: vi.fn(),
        onOpen: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    act(() => result.current.focusAt(0));
    act(() => result.current.onKeyDown(key('ArrowRight')));
    expect(result.current.focused).toBe(1);

    act(() => result.current.onKeyDown(key('ArrowDown')));
    expect(result.current.focused).toBe(4);

    act(() => result.current.focusAt(5));
    act(() => result.current.onKeyDown(key('ArrowDown')));
    expect(result.current.focused).toBe(5);

    act(() => result.current.onKeyDown(key('Home')));
    expect(result.current.focused).toBe(0);

    act(() => result.current.onKeyDown(key('End')));
    expect(result.current.focused).toBe(6);
  });

  it('selects on Enter, opens an already selected tile, and closes on Escape', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const props = { selectedIndex: null as number | null };
    const { result, rerender } = renderHook(() =>
      useGridNav({
        count: 4,
        selectedIndex: props.selectedIndex,
        columns: () => 2,
        onSelect,
        onOpen,
        onClose,
      }),
    );

    act(() => result.current.focusAt(2));
    act(() => result.current.onKeyDown(key('Enter')));
    expect(onSelect).toHaveBeenCalledWith(2);

    props.selectedIndex = 2;
    rerender();
    act(() => result.current.onKeyDown(key('Enter')));
    expect(onOpen).toHaveBeenCalledWith(2);

    act(() => result.current.onKeyDown(key('Escape')));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses the selected tile on arrival without scrolling, then scrolls to later tiles', () => {
    const container = document.createElement('div');
    container.innerHTML = '<button class="game-tile"></button><button class="game-tile"></button>';
    document.body.append(container);
    const tiles = [...container.querySelectorAll<HTMLButtonElement>('.game-tile')];
    const focus = tiles.map((tile) => vi.spyOn(tile, 'focus'));
    const { result } = renderHook(() =>
      useGridNav({
        count: 2,
        selectedIndex: 0,
        columns: () => 2,
        onSelect: vi.fn(),
        onOpen: vi.fn(),
        onClose: vi.fn(),
        containerRef: { current: container },
      }),
    );

    // a short phone screen: scrolling to the tile carried the spotlight's first decision off the top (#629)
    expect(focus[0]).toHaveBeenCalledWith({ preventScroll: true });
    act(() => result.current.onKeyDown(key('ArrowRight')));
    expect(focus[1]).toHaveBeenCalledWith({ preventScroll: false });
    container.remove();
  });
});
