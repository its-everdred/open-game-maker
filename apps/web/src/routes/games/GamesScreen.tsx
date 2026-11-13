import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { registerTestApi } from '../../app/testHook';
import { CopyLink } from './CopyLink';
import { glideTiles, measureTiles, type TileRects } from './flip';
import { Spotlight } from './Spotlight';
import { ShowcaseSpotlight } from './ShowcaseSpotlight';
import { ShowcaseMenuControls } from './ShowcaseMenuControls';
import { mergeShowcase } from './showcase';
import { Tile } from './Tile';
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
  const previousRects = useRef<TileRects>(new Map());
  const activeJobs = useMemo(() => indexActiveJobs(jobs), [jobs]);
  const sortedGames = useMemo(() => sortGames(games, activeJobs), [games, activeJobs]);
  const selectedIndex = selected ? sortedGames.findIndex((game) => game.id === selected.id) : null;
  const gridCapacity = useGridCapacity(gridRef, sortedGames.length > 0);
  const initialViewChosen = useRef(false);
  const fitsThumbnailRow = gridCapacity !== null && sortedGames.length <= gridCapacity;

  const select = (index: number) => {
    const game = sortedGames[index];
    if (!game) return;
    initialViewChosen.current = true;
    const next = new URLSearchParams(searchParams);
    next.set('spotlight', game.id);
    setSearchParams(next, { state: null });
  };

  const close = () => {
    initialViewChosen.current = true;
    const returningTo = selected?.id;
    const next = new URLSearchParams(searchParams);
    next.delete('spotlight');
    setSearchParams(next, { state: { spotlightDismissed: true } });
    queueMicrotask(() => {
      if (!returningTo) return;
      const cell = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-game-id]') ?? [])].find(
        (item) => item.dataset.gameId === returningTo,
      );
      cell?.querySelector<HTMLButtonElement>('button')?.focus();
    });
  };

  const open = (index: number, mode: 'play' | 'edit' = 'play', branchId?: string) => {
    const game = sortedGames[index];
    const branch =
      branches.find((item) => item.id === branchId) ?? branches.find((item) => item.name === 'main') ?? branches[0];
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

  useLayoutEffect(() => {
    glideTiles(gridRef.current, previousRects.current);
    previousRects.current = measureTiles(gridRef.current);
  }, [sortedGames]);

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
      {selected?.showcase ? (
        <ShowcaseSpotlight
          game={selected}
          canOpen={Boolean(
            (selected.id.startsWith('showcase:') && selected.showcase.id !== 'goblin-cellar') ||
            (target && (branches.find((branch) => branch.name === 'main') ?? branches[0])?.latestBuildId),
          )}
          onPlay={() => open(selectedIndex ?? -1, 'play')}
          onEdit={() => open(selectedIndex ?? -1, 'edit')}
          onClose={close}
        />
      ) : (
        selected && (
          <Spotlight
            game={selected}
            branches={branches}
            job={activeJobs.get(selected.id)}
            onPlay={(branchId) => open(selectedIndex ?? -1, 'play', branchId)}
            onEdit={(branchId) => open(selectedIndex ?? -1, 'edit', branchId)}
            onClose={close}
          />
        )
      )}

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
              <div ref={gridRef} className="games-grid" role="grid" aria-label="Your games" onKeyDown={nav.onKeyDown}>
                {sortedGames.map((game, index) => (
                  <div
                    key={game.id}
                    role="gridcell"
                    data-game-id={game.id}
                    className={game.id === selected?.id ? 'is-selected' : undefined}
                  >
                    <Tile
                      game={game}
                      job={activeJobs.get(game.id)}
                      selected={game.id === selected?.id}
                      tabIndex={nav.tabIndexFor(index)}
                      onFocus={() => nav.focusAt(index)}
                      onClick={() => {
                        nav.focusAt(index);
                        select(index);
                      }}
                    />
                    {!game.showcase && <CopyLink id={game.id} slug={game.slug} title={game.title} />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <button type="button" className="tap-primary games-new" aria-label="New game" onClick={() => navigate('/new')}>
        <span className="plus" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
          </svg>
        </span>
      </button>
    </div>
  );
}

// Changing the spotlight changes the screen error boundary's key, so the route
// remounts this screen while the closing navigation lands. The dismissal rides
// along on the history entry so the few-games select view stays dismissed.
function isSpotlightDismissed(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { spotlightDismissed?: unknown }).spotlightDismissed === true
  );
}

function sortGames(games: GameSummary[], jobs: ReadonlyMap<string, JobView>): GameSummary[] {
  return [...games].sort((left, right) => {
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
