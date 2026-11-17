import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getVolume, onChange, status } from '../../lib/sound';
import type { GameSummary } from './types';

export function GameTrailer({ game, transparentPoster = false }: { game: GameSummary; transparentPoster?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
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
    let current = true;
    const video = ref.current;
    if (video) {
      video.muted = true;
      video.volume = soundRef.current.volume;
      void video
        .play()
        .then(() => {
          if (current) {
            playing.current = video;
            video.volume = soundRef.current.volume;
            video.muted = soundRef.current.sound !== 'on';
          }
        })
        .catch(() => {});
    }
    return () => {
      current = false;
      playing.current = null;
      video?.pause();
    };
  }, [game.trailerUrl]);
  const transparent = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';
  const posters = game.coverImage?.sources.webp;
  const poster = transparentPoster
    ? transparent
    : (posters?.find((item) => item.width >= 640)?.path ?? posters?.at(-1)?.path ?? game.coverUrl ?? undefined);
  if (!game.trailerUrl) return null;
  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="auto"
      poster={poster}
      aria-label={`${game.title} trailer`}
      src={game.trailerUrl}
    />
  );
}
