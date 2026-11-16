import { useEffect, useRef } from 'react';
import type { GameSummary } from './types';

export function GameTrailer({ game, transparentPoster = false }: { game: GameSummary; transparentPoster?: boolean }) {
  const portrait = useRef<HTMLVideoElement>(null);
  const landscape = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!game.portraitTrailerUrl || !window.matchMedia) return;
    const orientation = window.matchMedia('(orientation: portrait)');
    const stopHidden = () => (orientation.matches ? landscape.current : portrait.current)?.pause();
    orientation.addEventListener('change', stopHidden);
    return () => orientation.removeEventListener('change', stopHidden);
  }, [game.portraitTrailerUrl]);
  const transparent = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';
  const posters = game.coverImage?.sources.webp;
  const poster = transparentPoster
    ? transparent
    : (posters?.find((item) => item.width >= 640)?.path ?? posters?.at(-1)?.path ?? game.coverUrl ?? undefined);
  return (
    <>
      {game.portraitTrailerUrl && (
        <video
          ref={portrait}
          className="game-trailer-portrait"
          controls
          playsInline
          preload="none"
          poster={poster}
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
        poster={poster}
        aria-label={`${game.title} trailer`}
        src={game.trailerUrl ?? undefined}
      />
    </>
  );
}
