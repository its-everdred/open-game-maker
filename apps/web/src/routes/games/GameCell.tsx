import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Cover } from './Cover';
import { GameTrailer } from './GameTrailer';
import type { GameSummary } from './types';

// The cover stays mounted while its slot moves between the tile and the spotlight.
export function GameCell({
  game,
  selected,
  tile,
  spotlight,
}: {
  game: GameSummary;
  selected: boolean;
  tile: ReactNode;
  spotlight: ReactNode;
}) {
  const cell = useRef<HTMLDivElement>(null);
  const lastSpotlight = useRef<ReactNode>(null);
  const [exiting, setExiting] = useState(false);
  const [showTrailer, setShowTrailer] = useState(selected);
  const wasSelected = useRef(selected);
  const previousSize = useRef<{ width: number; height: number } | null>(null);
  const [host] = useState(() => document.createElement('span'));
  host.className = 'game-cover-host';
  const closing = !selected && (wasSelected.current || exiting);
  useLayoutEffect(() => {
    if (selected && !wasSelected.current) setShowTrailer(false);
    if (selected) lastSpotlight.current = spotlight;
    const current = cell.current;
    const slot = current?.querySelector(
      selected ? '.game-cell-spotlight [data-cover-slot]' : '.game-cell-tile [data-cover-slot]',
    );
    slot?.appendChild(host);
    if (current && wasSelected.current && !selected && previousSize.current) {
      const layer = current.querySelector<HTMLElement>('.game-cell-exiting');
      const next = current.getBoundingClientRect();
      const old = previousSize.current;
      if (layer && old.width && old.height) {
        layer.style.width = `${old.width}px`;
        layer.style.height = `${old.height}px`;
        layer.style.transform = `scale(${next.width / old.width}, ${next.height / old.height})`;
      }
    }
    if (current && selected) {
      previousSize.current = { width: current.offsetWidth, height: current.offsetHeight };
    }
    if (wasSelected.current && !selected) setExiting(true);
    wasSelected.current = selected;
  });
  useEffect(() => {
    if (selected || !exiting) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setExiting(false);
      return;
    }
    const timer = window.setTimeout(() => setExiting(false), 300);
    return () => window.clearTimeout(timer);
  }, [selected, exiting]);
  useEffect(() => {
    if (!game.trailerUrl) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setShowTrailer(selected), reduced ? 0 : 300);
    return () => window.clearTimeout(timer);
  }, [game.trailerUrl, selected]);
  return (
    <div ref={cell} role="gridcell" data-game-id={game.id} className={selected ? 'is-selected' : undefined}>
      <div className="game-cell-tile" aria-hidden={selected || undefined} inert={selected}>
        {tile}
      </div>
      {(selected || closing) && (
        <div
          className={selected ? 'game-cell-spotlight' : 'game-cell-spotlight game-cell-exiting'}
          aria-hidden={!selected || undefined}
          inert={!selected}
        >
          {selected ? spotlight : lastSpotlight.current}
        </div>
      )}
      {createPortal(
        <>
          <Cover game={game} hero={selected} />
          {game.trailerUrl && showTrailer && (
            <span className={`game-trailer-layer${selected ? '' : ' is-closing'}`}>
              <GameTrailer game={game} transparentPoster />
            </span>
          )}
        </>,
        host,
      )}
    </div>
  );
}
