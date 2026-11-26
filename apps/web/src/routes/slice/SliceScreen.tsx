import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { Icon } from '../../components/Icon';
import { getBuildDesign, getDesignSnapshot } from '../../features/editor/api';
import { mountGameFrame, type GameFrameState } from '../../features/editor/frame';
import '../../features/commands-inbox/review-deck.css';
import './slice.css';

// A playable slice: the game waits behind one tap, so a card full of slices loads nothing until one is played and the
// tap that starts it is the one that lets its sound play. The game then boots straight into the scenario.
export function SliceScreen() {
  const { gameId = '' } = useParams();
  const [search] = useSearchParams();
  const buildId = search.get('build')?.trim() || undefined;
  const scenario = search.get('scenario')?.trim() || undefined;
  const seed = search.get('seed')?.trim() || undefined;
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<GameFrameState['bridgeState']>('connecting');
  const container = useRef<HTMLDivElement>(null);
  const design = useQuery({
    queryKey: buildId ? ['build-design', gameId, buildId] : ['design', gameId, 'main'],
    queryFn: () => (buildId ? getBuildDesign(gameId, buildId) : getDesignSnapshot(gameId, 'main')),
    enabled: gameId !== '',
  });
  const snapshot = design.data;

  useEffect(() => {
    const element = container.current;
    if (!started || element === null || snapshot === undefined) return;
    const controller = mountGameFrame({
      container: element,
      gamesOrigin: import.meta.env.VITE_GAMES_ORIGIN ?? 'http://127.0.0.1:10000',
      gameId,
      buildId: snapshot.buildId,
      authenticated: true,
      mode: 'play',
      design: snapshot,
      params: { ...(scenario ? { scenario } : {}), ...(seed ? { seed } : {}) },
      onState: (next) => setState(next.bridgeState),
    });
    element.querySelector('iframe')?.focus({ preventScroll: true });
    return () => controller.dispose();
  }, [gameId, scenario, seed, snapshot, started]);

  return (
    <main className="slice-screen review-deck-playable">
      <div className="review-deck-playable-frame" ref={container} />
      {design.isError || state === 'error' ? (
        <p className="review-deck-playable-state slice-screen-state" role="status">
          The game did not load.
        </p>
      ) : started ? null : (
        <div className="review-deck-playable-ended">
          <button
            aria-label="Play"
            className="review-deck-replay tap-secondary"
            disabled={snapshot === undefined}
            onClick={() => setStarted(true)}
            type="button"
          >
            <Icon name="play" />
          </button>
        </div>
      )}
    </main>
  );
}
