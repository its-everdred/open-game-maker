import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getVolume, onChange, status } from '../../lib/sound';
import type { GameSummary } from './types';

export function GameTrailer({ game, transparentPoster = false }: { game: GameSummary; transparentPoster?: boolean }) {
  const portrait = useRef<HTMLVideoElement>(null);
  const landscape = useRef<HTMLVideoElement>(null);
  const sound = useSyncExternalStore(onChange, status);
  const volume = useSyncExternalStore(onChange, getVolume);
  const soundRef = useRef({ sound, volume });
  const playing = useRef<HTMLVideoElement | null>(null);
  soundRef.current = { sound, volume };
  useEffect(() => {
    if (playing.current) {
      playing.current.muted = sound !== 'on';
      playing.current.volume = volume;
    }
  }, [sound, volume]);
  useEffect(() => {
    let generation = 0;
    const portraitVideo = portrait.current;
    const landscapeVideo = landscape.current;
    const orientation = window.matchMedia?.('(orientation: portrait)');
    const update = () => {
      const current = ++generation;
      const usePortrait = Boolean(game.portraitTrailerUrl && (!game.trailerUrl || orientation?.matches));
      const active = usePortrait ? portraitVideo : landscapeVideo;
      const hidden = usePortrait ? landscapeVideo : portraitVideo;
      hidden?.pause();
      playing.current = null;
      if (active) {
        active.muted = true;
        active.volume = soundRef.current.volume;
        void active
          .play()
          .then(() => {
            if (current === generation) {
              playing.current = active;
              active.volume = soundRef.current.volume;
              active.muted = soundRef.current.sound !== 'on';
            }
          })
          .catch(() => {});
      }
    };
    update();
    orientation?.addEventListener('change', update);
    return () => {
      generation++;
      playing.current = null;
      orientation?.removeEventListener('change', update);
      portraitVideo?.pause();
      landscapeVideo?.pause();
    };
  }, [game.portraitTrailerUrl, game.trailerUrl]);
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
          className={game.trailerUrl ? 'game-trailer-portrait' : undefined}
          muted
          loop
          playsInline
          preload="auto"
          poster={poster}
          aria-label={`${game.title} trailer`}
          src={game.portraitTrailerUrl}
        />
      )}
      {game.trailerUrl && (
        <video
          ref={landscape}
          className={game.portraitTrailerUrl ? 'game-trailer-landscape' : undefined}
          muted
          loop
          playsInline
          preload="auto"
          poster={poster}
          aria-label={`${game.title} trailer`}
          src={game.trailerUrl ?? undefined}
        />
      )}
    </>
  );
}
