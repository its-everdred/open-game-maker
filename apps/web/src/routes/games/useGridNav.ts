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
    const tile = options.containerRef?.current?.querySelectorAll<HTMLButtonElement>('.game-tile')[focused];
    if (!tile) return;
    tile.focus({ preventScroll: !arrived.current });
    arrived.current = true;
  }, [focused, options.containerRef]);

  const focusAt = useCallback(
    (index: number) => setFocused(Math.max(0, Math.min(index, Math.max(0, options.count - 1)))),
    [options.count],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
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

      event.preventDefault();
      setFocused(next);
    },
    [focused, options],
  );

  return {
    focused,
    focusAt,
    tabIndexFor: (index: number) => (index === focused ? 0 : -1),
    onKeyDown,
  };
}

export function measureGridColumns(container: HTMLElement | null): number {
  const tiles = [...(container?.querySelectorAll<HTMLElement>('[role="gridcell"]') ?? [])];
  if (tiles.length < 2) return 1;
  const firstTop = tiles[0]!.offsetTop;
  const columns = tiles.findIndex((tile) => tile.offsetTop !== firstTop);
  return columns === -1 ? tiles.length : Math.max(1, columns);
}
