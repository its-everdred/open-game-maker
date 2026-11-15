import { countGridTracks } from './useGridCapacity';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

type GridNavOptions = {
  count: number;
  selectedIndex: number | null;
  columns(): number;
  onSelect(index: number): void;
  onOpen(index: number): void;
  onClose(): void;
  containerRef?: RefObject<HTMLElement | null>;
};

export function useGridNav(options: GridNavOptions) {
  const [focused, setFocused] = useState(Math.max(0, options.selectedIndex ?? 0));

  useEffect(() => {
    setFocused((current) => Math.min(current, Math.max(0, options.count - 1)));
  }, [options.count]);

  useEffect(() => {
    if (options.selectedIndex !== null) setFocused(options.selectedIndex);
  }, [options.selectedIndex]);

  // Arriving focuses the selected tile without scrolling to it: on a short screen the scroll carried the spotlight's
  // title and first decision off the top (#629). Moving between tiles afterwards still scrolls them into view.
  const arrived = useRef(false);
  useEffect(() => {
    if (focused === options.selectedIndex) return;
    const cell = options.containerRef?.current?.querySelectorAll<HTMLElement>('[role=gridcell]')[focused];
    const tile = cell?.querySelector<HTMLButtonElement>('.game-tile');
    // already focused: StrictMode's second effect run must not spend the arrival
    if (!tile || tile === document.activeElement) return;
    tile.focus({ preventScroll: !arrived.current });
    arrived.current = true;
  }, [focused, options.containerRef, options.selectedIndex]);

  const focusAt = useCallback(
    (index: number) => setFocused(Math.max(0, Math.min(index, Math.max(0, options.count - 1)))),
    [options.count],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('.games-spotlight')) return;
      const columns = Math.max(1, options.columns());
      let next = focused;

      switch (event.key) {
        case 'ArrowLeft':
          next = Math.max(0, focused - 1);
          break;
        case 'ArrowRight':
          next = Math.min(options.count - 1, focused + 1);
          break;
        case 'ArrowUp':
          if (focused - columns >= 0) next = focused - columns;
          break;
        case 'ArrowDown':
          if (focused + columns < options.count) next = focused + columns;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = Math.max(0, options.count - 1);
          break;
        case 'Enter':
          event.preventDefault();
          if (focused === options.selectedIndex) options.onOpen(focused);
          else options.onSelect(focused);
          return;
        case 'Escape':
          event.preventDefault();
          options.onClose();
          return;
        default:
          return;
      }

      if (next === options.selectedIndex && next !== focused) {
        const candidate = next + (next > focused ? 1 : -1);
        next = candidate >= 0 && candidate < options.count ? candidate : focused;
      }
      event.preventDefault();
      setFocused(next);
    },
    [focused, options],
  );

  return {
    focused,
    focusAt,
    tabIndexFor: (index: number) => {
      const tabStop = focused === options.selectedIndex ? (focused === 0 ? 1 : 0) : focused;
      return index === tabStop ? 0 : -1;
    },
    onKeyDown,
  };
}

export function measureGridColumns(container: HTMLElement | null): number {
  if (!container) return 1;
  return Math.max(1, countGridTracks(getComputedStyle(container).gridTemplateColumns));
}
