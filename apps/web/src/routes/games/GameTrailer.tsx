import { useEffect, useRef } from 'react';
import type { GameSummary } from './types';

export function GameTrailer({ game }: { game: GameSummary }) {
  const portrait = useRef<HTMLVideoElement>(null);
  const landscape = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!game.portraitTrailerUrl || !window.matchMedia) return;
    const orientation = window.matchMedia('(orientation: portrait)');
    const stopHidden = () => (orientation.matches ? landscape.current : portrait.current)?.pause();
    orientation.addEventListener('change', stopHidden);
    return () => orientation.removeEventListener('change', stopHidden);
  }, [game.portraitTrailerUrl]);
  return (
    <>
      {game.portraitTrailerUrl && (
        <video
          ref={portrait}
          className="game-trailer-portrait"
          controls
          playsInline
          preload="none"
          poster={game.coverUrl ?? undefined}
          aria-label={`${game.title} trailer`}
          src={game.portraitTrailerUrl}
        />
      )}
      <video
        ref={landscape}
        className={game.portraitTrailerUrl ? 'game-trailer-landscape' : undefined}
        controls
        playsInline
        preload="none"
        poster={game.coverUrl ?? undefined}
        aria-label={`${game.title} trailer`}
        src={game.trailerUrl ?? undefined}
      />
    </>
  );
}
