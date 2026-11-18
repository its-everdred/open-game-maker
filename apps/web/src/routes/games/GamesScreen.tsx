import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { registerTestApi } from '../../app/testHook';
import { CopyLink } from './CopyLink';
import { GameCell } from './GameCell';
import {
  cancelGlides,
  fitExitingLayers,
  glideCover,
  glideTiles,
  measureCovers,
  measureTiles,
  type CoverRect,
  type TileRects,
} from './flip';
import { GameDetail } from './GameDetail';
import { startTrailer, stopTrailers } from './trailerVideo';
import { ShowcaseMenuControls } from './ShowcaseMenuControls';
import { mergeShowcase } from './showcase';
import { Tile } from './Tile';
import { TransitionGrid } from './TransitionGrid';
import { gameUpdatedAt, type GameSummary, type JobView } from './types';
import { indexActiveJobs, useActiveJobs } from './useActiveJobs';
import { useBranches } from './useBranches';
import { useGames } from './useGames';
import { measureGridColumns, useGridNav } from './useGridNav';
import { useGridCapacity } from './useGridCapacity';
import './games.css';
import './games-responsive.css';

let gamesApiRegistered = false;
const gamesTestSnapshot: { selected: string | null; tiles: string[] } = { selected: null, tiles: [] };

export function GamesScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const spotlightDismissed = isSpotlightDismissed(location.state);

  const gamesQuery = useGames();
  const jobsQuery = useActiveJobs();
  const realGames = gamesQuery.data ?? [];
  const games = useMemo(() => mergeShowcase(gamesQuery.data ?? []), [gamesQuery.data]);
  const jobs = jobsQuery.data ?? [];
  const selectedId = searchParams.get('spotlight');
  const selected = games.find((game) => game.id === selectedId) ?? null;
  const goblin = realGames.find(
    (item) => item.slug === 'goblin-cellar' || (!item.slug && item.title === 'Goblin Cellar'),
  );
  const target = selected?.id.startsWith('showcase:')
    ? selected.showcase?.id === 'goblin-cellar'
      ? goblin
      : null
    : selected;
  const branchesQuery = useBranches(target?.id ?? null);
  const branches = branchesQuery.data ?? [];
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingRects = useRef<TileRects | null>(null);
  const pendingFocusId = useRef<string | null>(null);
  const pendingCovers = useRef<Map<string, CoverRect> | null>(null);
  const previousRects = useRef<TileRects>(new Map());
  const previousCovers = useRef(new Map<string, CoverRect>());
  const lastLayout = useRef<{ games: GameSummary[]; selectedId: string | null } | null>(null);
  const activeJobs = useMemo(() => indexActiveJobs(jobs), [jobs]);
  const sortedGames = useMemo(() => sortGames(games, activeJobs), [games, activeJobs]);
  const selectedIndex = selected ? sortedGames.findIndex((game) => game.id === selected.id) : null;
  const gridCapacity = useGridCapacity(gridRef, sortedGames.length > 0);
  const initialViewChosen = useRef(false);
  const fitsThumbnailRow = gridCapacity !== null && sortedGames.length <= gridCapacity;

  const captureTransition = () => {
    pendingRects.current = measureTiles(gridRef.current);
    pendingCovers.current = measureCovers(gridRef.current);
  };

  const select = (index: number) => {
    const game = sortedGames[index];
    if (!game) return;
    startTrailer(game);
    initialViewChosen.current = true;
    captureTransition();
    const next = new URLSearchParams(searchParams);
    next.set('spotlight', game.id);
    setSearchParams(next, { state: null });
  };

  const close = () => {
    stopTrailers();
    initialViewChosen.current = true;
    const returningTo = selected?.id;
    captureTransition();
    const next = new URLSearchParams(searchParams);
    next.delete('spotlight');
    setSearchParams(next, { state: { spotlightDismissed: true } });
    pendingFocusId.current = returningTo ?? null;
  };

  const open = (index: number, mode: 'play' | 'edit' = 'play') => {
    const game = sortedGames[index];
    const branch = branches.find((item) => item.name === 'main') ?? branches[0];
    if (!game || game.id !== selected?.id) return;
    if (game.id.startsWith('showcase:') && game.showcase && game.showcase.id !== 'goblin-cellar') {
      navigate(`/g/showcase/${encodeURIComponent(game.showcase.id)}?mode=${mode}`);
      return;
    }
    if (!target || !branch?.latestBuildId) return;
    navigate(`/g/${encodeURIComponent(target.id)}?v=${encodeURIComponent(branch.id)}&mode=${mode}`);
  };

  const nav = useGridNav({
    count: sortedGames.length,
    selectedIndex,
    columns: () => measureGridColumns(gridRef.current),
    onSelect: select,
    onOpen: open,
    onClose: close,
    containerRef: gridRef,
  });

  useEffect(() => {
    if (initialViewChosen.current || gamesQuery.isPending || jobsQuery.isPending) return;
    if (sortedGames.length === 0) return;
    if (gridCapacity === null) return;

    initialViewChosen.current = true;
    if (selectedId || spotlightDismissed || !fitsThumbnailRow) return;
    const next = new URLSearchParams(searchParams);
    next.set('spotlight', sortedGames[0]!.id);
    setSearchParams(next, { replace: true });
  }, [
    fitsThumbnailRow,
    gamesQuery.isPending,
    gridCapacity,
    jobsQuery.isPending,
    searchParams,
    selectedId,
    setSearchParams,
    sortedGames,
    spotlightDismissed,
  ]);

  useEffect(() => {
    if (!pendingFocusId.current || selectedId || !gridRef.current) return;
    const cell = [...gridRef.current.querySelectorAll<HTMLElement>('[data-game-id]')].find(
      (item) => item.dataset.gameId === pendingFocusId.current,
    );
    cell?.querySelector<HTMLButtonElement>('.game-tile')?.focus();
    pendingFocusId.current = null;
  }, [selectedId, gamesQuery.isPending]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const previousSelection = lastLayout.current?.selectedId;
    if (lastLayout.current?.games !== sortedGames || previousSelection !== selectedId) {
      lastLayout.current = { games: sortedGames, selectedId };
      cancelGlides();
      fitExitingLayers(grid);
      const nextRects = measureTiles(grid);
      const before = pendingRects.current ?? previousRects.current;
      for (const id of new Set([selectedId, previousSelection])) {
        if (!id) continue;
        const cover = pendingCovers.current?.get(id) ?? previousCovers.current.get(id) ?? null;
        glideCover(grid, before, cover);
      }
      glideTiles(grid, before);
      pendingCovers.current = null;
      pendingRects.current = null;
      previousRects.current = nextRects;
    }
    return () => {
      previousRects.current = measureTiles(grid);
      previousCovers.current = measureCovers(grid);
    };
  }, [sortedGames, selectedId, gamesQuery.isPending]);

  gamesTestSnapshot.selected = selected?.id ?? null;
  gamesTestSnapshot.tiles = sortedGames.map((game) => game.id);
  useEffect(() => {
    if (gamesApiRegistered || !window.__ogmHost) return;
    gamesApiRegistered = true;
    registerTestApi('games', {
      selected: () => gamesTestSnapshot.selected,
      tiles: () => [...gamesTestSnapshot.tiles],
    });
  }, []);

  if (gamesQuery.isPending) return <p className="games-status">Loading your games…</p>;

  return (
    <div className={`games-screen${fitsThumbnailRow ? ' games-single-row' : ''}`}>
      {selected?.showcase && !selected.id.startsWith('showcase:') && <ShowcaseMenuControls game={selected} />}

      {gamesQuery.isError && games.length === 0 ? (
        <RetryLine onRetry={() => void gamesQuery.refetch()} />
      ) : (
        <>
          {(gamesQuery.isError || branchesQuery.isError) && (
            <RetryLine
              onRetry={() => void Promise.all([gamesQuery.refetch(), jobsQuery.refetch(), branchesQuery.refetch()])}
            />
          )}
          {sortedGames.length === 0 ? (
            <p className="games-empty">No games yet. Start with a new idea.</p>
          ) : (
            <div className="games-floor">
              <TransitionGrid
                gridRef={gridRef}
                order={sortedGames}
                selectedId={selectedId}
                onSnapshot={captureTransition}
                onKeyDown={nav.onKeyDown}
              >
                {sortedGames.map((game, index) => (
                  <GameCell
                    key={game.id}
                    game={game}
                    selected={game.id === selected?.id}
                    tile={
                      <>
                        <Tile
                          game={game}
                          sharedCover
                          job={activeJobs.get(game.id)}
                          selected={false}
                          tabIndex={nav.tabIndexFor(index)}
                          onFocus={() => nav.focusAt(index)}
                          onClick={() => {
                            nav.focusAt(index);
                            select(index);
                          }}
                        />
                        {!game.showcase && <CopyLink id={game.id} slug={game.slug} title={game.title} />}
                      </>
                    }
                    spotlight={
                      game.id === selected?.id && selected ? (
                        <GameDetail
                          game={selected}
                          sharedCover
                          job={activeJobs.get(selected.id)}
                          canOpen={Boolean(
                            (selected.id.startsWith('showcase:') && selected.showcase?.id !== 'goblin-cellar') ||
                            (target &&
                              (branches.find((branch) => branch.name === 'main') ?? branches[0])?.latestBuildId &&
                              activeJobs.get(selected.id)?.kind !== 'new_game'),
                          )}
                          onPlay={() => open(selectedIndex ?? -1, 'play')}
                          onEdit={() => open(selectedIndex ?? -1, 'edit')}
                          onClose={close}
                        />
                      ) : null
                    }
                  />
                ))}
              </TransitionGrid>
            </div>
          )}
        </>
      )}

      {!selected && (
        <button type="button" className="tap-primary games-new" aria-label="New game" onClick={() => navigate('/new')}>
          <span className="plus" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}

// The dismissal rides on the history entry so the few-games select view stays dismissed.
function isSpotlightDismissed(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { spotlightDismissed?: unknown }).spotlightDismissed === true
  );
}

function sortGames(games: GameSummary[], jobs: ReadonlyMap<string, JobView>): GameSummary[] {
  return [...games].sort((left, right) => {
    if (left.lastPlayedAt || right.lastPlayedAt) {
      return (right.lastPlayedAt ?? '').localeCompare(left.lastPlayedAt ?? '');
    }
    if (left.showcase && right.showcase) return 0;
    if (left.showcase) return -1;
    if (right.showcase) return 1;
    const building = Number(jobs.has(right.id)) - Number(jobs.has(left.id));
    return building || gameUpdatedAt(right).localeCompare(gameUpdatedAt(left));
  });
}

function RetryLine({ onRetry }: { onRetry(): void }) {
  return (
    <p className="games-retry" role="alert">
      Couldn’t refresh the library.{' '}
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}
