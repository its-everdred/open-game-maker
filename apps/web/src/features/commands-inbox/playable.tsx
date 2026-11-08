import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { GameCommand } from '@ogm/contracts/browser';

import { Icon } from '../../components/Icon';
import { getDesignSnapshot } from '../editor/api';
import { mountGameFrame, type GameFrameState } from '../editor/frame';
import { nextCompare, playableParams, withoutLinks } from './review';

type Option = GameCommand['options'][number];

// A playable card (#608): a gameplay-feel question is judged by playing it, so the card runs a short slice of the game
// itself. The game's build plays in the card's own sandboxed frame from the games host (its CSP and frame-ancestors
// still apply) with the option's scenario, and the host's touch buttons, keys and gamepad drive it. After the option's
// seconds the game pauses and the deck's like and dislike take over; judging moves to the next card, whose slice starts
// on its own. Once paused, the card offers the slice again and, when more than one option is playable, a compare run
// that plays every option in turn.
export function PlayableCard({ gameId, card, options }: { gameId: string; card: Option; options: Option[] }) {
  // The option on screen: the card's own, or the one a compare run is playing.
  const [comparing, setComparing] = useState<number | null>(null);
  const [run, setRun] = useState(0);
  const [ended, setEnded] = useState(false);
  const shown = comparing === null ? card : options[comparing]!;
  const playableCount = options.filter(({ playable }) => playable !== undefined).length;

  const finish = () => {
    if (comparing !== null) {
      const next = nextCompare(options, comparing);
      if (next !== null) {
        setComparing(next);
        setRun((value) => value + 1);
        return;
      }
    }
    setEnded(true);
  };
  const restart = (compare: number | null) => {
    setComparing(compare);
    setEnded(false);
    setRun((value) => value + 1);
  };

  return (
    <div className="review-deck-playable">
      <PlayableSlice key={`${shown.id}:${run}`} gameId={gameId} option={shown} onEnded={finish} />
      {comparing === null ? null : <p className="review-deck-playable-tag">{withoutLinks(shown.label)}</p>}
      {ended ? (
        <div className="review-deck-playable-ended">
          <button
            aria-label={`Play ${withoutLinks(card.label)} again`}
            className="review-deck-replay tap-secondary"
            onClick={() => restart(null)}
            type="button"
          >
            <Icon name="replay" />
          </button>
          {playableCount > 1 ? (
            <button
              aria-label="Compare every option"
              className="review-deck-replay tap-secondary"
              onClick={() => restart(nextCompare(options, -1))}
              type="button"
            >
              <Icon name="compare" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// One slice: load the build, play for the option's seconds once the game is ready, then pause and report the end.
function PlayableSlice({ gameId, option, onEnded }: { gameId: string; option: Option; onEnded(): void }) {
  // The inbox refetches its Commands, so the slice keys on the playable's values rather than on the object.
  const { scenario, lead_in: leadIn, seconds, branch = 'main' } = option.playable!;
  const container = useRef<HTMLDivElement>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const [state, setState] = useState<GameFrameState['bridgeState']>('connecting');
  const design = useQuery({ queryKey: ['design', gameId, branch], queryFn: () => getDesignSnapshot(gameId, branch) });
  const snapshot = design.data;

  useEffect(() => {
    const element = container.current;
    if (element === null || snapshot === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = mountGameFrame({
      container: element,
      gamesOrigin: import.meta.env.VITE_GAMES_ORIGIN ?? 'http://127.0.0.1:10000',
      gameId,
      buildId: snapshot.buildId,
      mode: 'play',
      design: snapshot,
      params: playableParams({ scenario, seconds, ...(leadIn === undefined ? {} : { lead_in: leadIn }) }),
      onState: (next) => {
        setState(next.bridgeState);
        if (next.bridgeState !== 'ready' || timer !== undefined) return;
        // The keys go to the game while it plays, then back to the deck's arrows once it pauses.
        element.querySelector('iframe')?.focus();
        timer = setTimeout(() => {
          controller.pause();
          element.closest<HTMLElement>('.review-deck')?.focus();
          ended.current();
        }, seconds * 1000);
      },
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      controller.dispose();
    };
  }, [gameId, leadIn, scenario, seconds, snapshot]);

  return (
    <div className="review-deck-playable-frame" ref={container}>
      {design.isError || state === 'error' ? (
        <p className="review-deck-playable-state" role="status">
          The game did not load.
        </p>
      ) : null}
    </div>
  );
}
