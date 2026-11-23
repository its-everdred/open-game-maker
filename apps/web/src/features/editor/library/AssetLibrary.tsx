import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { EditorLibrary, EditorLibraryItem } from '@ogm/contracts/browser';

import { Icon } from '../../../components/Icon';
import { api } from '../../../lib/api/client';
import { chooseGroup, filterLibrary, finerChips, toggleChip, type LibraryFilter } from './library-filter';
import './asset-library.css';

/** Where a piece was dropped or tapped, in page coordinates over the game; the map maker turns it into a cell. */
export type PlacePoint = { clientX: number; clientY: number };

const GROUP_ICONS: Record<string, string> = {
  ground: 'ground',
  fences: 'fence',
  walls: 'wall',
  doors: 'door',
  roofs: 'roof',
  nature: 'tree',
  props: 'chest',
  characters: 'person',
  effects: 'sparkle',
};
/** A press that moves this far is a drag, not a tap. */
const DRAG_PX = 6;
const GAP = 8;
const LABEL_H = 22;
const OVERSCAN_ROWS = 2;

export function libraryThumbUrl(gameId: string, card: string): string {
  return `/api/v1/games/${encodeURIComponent(gameId)}/editor/library/thumb?card=${encodeURIComponent(card)}`;
}

/**
 * The map maker's asset library (Kevin's approved browse sheet, #1191 direction A): search, kind chips, finer chips and
 * labelled thumbnails. Drag a piece onto the game with a mouse; on a phone, tap a piece to arm it, then tap the game.
 * `onPlace` hands the piece and the point to the editor (#1209), which owns snapping and the scene document.
 */
export function AssetLibrary({
  gameId,
  onPlace,
}: {
  gameId: string;
  onPlace?(asset: string, point: PlacePoint): void;
}) {
  const library = useQuery({
    queryKey: ['editor', 'library', gameId],
    queryFn: () => api<EditorLibrary>(`/games/${encodeURIComponent(gameId)}/editor/library`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>({ query: '' });
  const [armed, setArmed] = useState<string>();
  const [drag, setDrag] = useState<{ id: string; x: number; y: number }>();
  const sheet = useRef<HTMLElement>(null);
  const targetPressed = useRef(false);
  const data = library.data;
  const shown = useMemo(() => (data ? filterLibrary(data, filter) : []), [data, filter]);
  const chips = useMemo(() => (data && filter.group ? finerChips(data, filter) : []), [data, filter]);
  const armedItem = armed ? data?.items.find((item) => item.id === armed) : undefined;

  useEffect(() => {
    if (!armed) return;
    const disarm = (event: KeyboardEvent) => event.key === 'Escape' && setArmed(undefined);
    window.addEventListener('keydown', disarm);
    return () => window.removeEventListener('keydown', disarm);
  }, [armed]);

  if (!data || data.items.length === 0) return null;

  /** A drop counts only over the game, never over the sheet itself. */
  const overGame = (x: number, y: number) => {
    const frame = sheet.current?.closest('.game-stage')?.querySelector('.game-frame');
    const box = frame?.getBoundingClientRect();
    const own = sheet.current?.getBoundingClientRect();
    if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) return false;
    return !own || x < own.left || x > own.right || y < own.top || y > own.bottom;
  };

  return (
    <div className="asset-library-layer">
      {armedItem && onPlace ? (
        <button
          className="asset-library-target"
          type="button"
          aria-label={`Place ${armedItem.label}`}
          /* Only a press that starts here places: the tap that armed the piece must not land as a place. */
          onPointerDown={() => (targetPressed.current = true)}
          onClick={(event) => {
            if (!targetPressed.current && event.detail !== 0) return;
            targetPressed.current = false;
            onPlace(armedItem.id, { clientX: event.clientX, clientY: event.clientY });
          }}
        />
      ) : null}
      <section
        ref={sheet}
        className={open ? 'asset-library is-open' : 'asset-library'}
        aria-label="Library"
        /* The chat bubble rises above the sheet; the value changes with its height so the edit page measures again. */
        data-bubble-clear={open ? 'open' : 'closed'}
      >
        <button
          className="asset-library-handle"
          type="button"
          aria-label="Library"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        />
        <label className="asset-library-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Search"
            value={filter.query}
            onFocus={() => setOpen(true)}
            onChange={(event) => setFilter({ ...filter, query: event.target.value })}
          />
          <span className="asset-library-count">{shown.length.toLocaleString('en')}</span>
        </label>
        <div className="asset-library-chips" role="group" aria-label="Kinds">
          {data.groups.map((group) => (
            <button
              key={group.id}
              className="asset-library-chip"
              type="button"
              aria-pressed={filter.group === group.id}
              onClick={() => {
                setFilter(chooseGroup(filter, group.id));
                setOpen(true);
              }}
            >
              <Icon name={GROUP_ICONS[group.id] ?? 'chest'} />
              {group.label}
            </button>
          ))}
        </div>
        {open && chips.length > 0 ? (
          <div className="asset-library-chips is-finer" role="group" aria-label="Filters">
            {chips.map((chip) => (
              <button
                key={`${chip.step}:${chip.value}`}
                className={`asset-library-chip is-${chip.step}`}
                type="button"
                aria-pressed={filter[chip.step] === chip.value}
                onClick={() => setFilter(toggleChip(filter, chip))}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}
        {open ? (
          <LibraryGrid
            gameId={gameId}
            items={shown}
            armed={armed}
            onArm={(id, touch) => {
              setArmed((current) => (current === id ? undefined : id));
              targetPressed.current = false;
              /* On a phone the sheet covers the game: get it out of the way so the next tap can place. */
              if (touch && onPlace) setOpen(false);
            }}
            onDrag={setDrag}
            onDrop={(id, x, y) => {
              setDrag(undefined);
              if (overGame(x, y)) onPlace?.(id, { clientX: x, clientY: y });
            }}
          />
        ) : null}
      </section>
      {drag ? (
        <img
          className="asset-library-ghost"
          src={libraryThumbUrl(gameId, drag.id)}
          alt=""
          style={{ left: drag.x, top: drag.y }}
        />
      ) : null}
    </div>
  );
}

type Press = { id: string; pointerId: number; x: number; y: number; dragging: boolean; touch: boolean };

/** A windowed grid: only the rows in view (and a few either side) are in the page, so thousands of pieces scroll. */
function LibraryGrid({
  gameId,
  items,
  armed,
  onArm,
  onDrag,
  onDrop,
}: {
  gameId: string;
  items: readonly EditorLibraryItem[];
  armed?: string;
  onArm(id: string, touch: boolean): void;
  onDrag(drag: { id: string; x: number; y: number } | undefined): void;
  onDrop(id: string, x: number, y: number): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const press = useRef<Press | undefined>(undefined);
  const [view, setView] = useState({ width: 0, height: 0, top: 0 });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setView({ width: element.clientWidth, height: element.clientHeight, top: element.scrollTop });
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 });
  }, [items]);
  /* A drag whose tile leaves the page (the list changed or the sheet closed) must not leave its ghost behind. */
  useEffect(
    () => () => {
      if (press.current?.dragging) onDrag(undefined);
    },
    [onDrag],
  );

  const columns = Math.min(8, Math.max(4, Math.floor(view.width / 140)));
  const tile = view.width > 0 ? (view.width - GAP * (columns - 1)) / columns : 0;
  const picture = Math.min(tile * 0.9, 96);
  const rowHeight = picture + LABEL_H + GAP;
  const rows = Math.ceil(items.length / columns);
  const first = rowHeight > 0 ? Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN_ROWS) : 0;
  const last = rowHeight > 0 ? Math.min(rows, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN_ROWS) : 0;
  const visible = items.slice(first * columns, last * columns);

  const down = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    press.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
      touch: event.pointerType !== 'mouse',
    };
    /* Mouse drags keep their events even over the game's iframe; touch keeps the grid scrollable. */
    if (event.pointerType === 'mouse') event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    if (!current || current.touch || current.pointerId !== event.pointerId) return;
    if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_PX) return;
    current.dragging = true;
    onDrag({ id: current.id, x: event.clientX, y: event.clientY });
  };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    press.current = undefined;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.dragging) onDrop(current.id, event.clientX, event.clientY);
    else onArm(current.id, current.touch);
  };
  const cancel = () => {
    if (press.current?.dragging) onDrag(undefined);
    press.current = undefined;
  };

  return (
    <div
      ref={scroller}
      className="asset-library-grid"
      onScroll={(event) => {
        /* Re-render only when another row comes into view, not on every scrolled pixel. */
        const top = rowHeight > 0 ? Math.floor(event.currentTarget.scrollTop / rowHeight) * rowHeight : 0;
        setView((current) => (current.top === top ? current : { ...current, top }));
      }}
    >
      <div style={{ height: rows * rowHeight, position: 'relative' }}>
        {visible.map((item, offset) => {
          const index = first * columns + offset;
          return (
            <button
              key={item.id}
              className="asset-library-item"
              type="button"
              aria-label={item.label}
              aria-pressed={armed === item.id}
              style={{
                left: (index % columns) * (tile + GAP),
                top: Math.floor(index / columns) * rowHeight,
                width: tile,
              }}
              onPointerDown={(event) => down(event, item.id)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={cancel}
              onLostPointerCapture={cancel}
              onClick={(event) => {
                /* Keyboard and assistive taps arrive as clicks with no pointer press. */
                if (event.detail === 0) onArm(item.id, false);
              }}
            >
              <span className="asset-library-picture" style={{ height: picture }}>
                <img
                  src={libraryThumbUrl(gameId, item.id)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  /* A piece whose picture is missing keeps its label on an empty tile, not a broken image. */
                  onError={(event) => (event.currentTarget.hidden = true)}
                />
              </span>
              <span className="asset-library-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
