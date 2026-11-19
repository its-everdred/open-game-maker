import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getVolume, onChange, status } from '../../lib/sound';
import { playTrailer, stopTrailers, trailerVideo } from './trailerVideo';
import type { GameSummary } from './types';

export function GameTrailer({ game, transparentPoster = false }: { game: GameSummary; transparentPoster?: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const sound = useSyncExternalStore(onChange, status);
  const volume = useSyncExternalStore(onChange, getVolume);
  const playing = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = playing.current;
    if (!video) return;
    video.volume = volume;
    video.muted = sound === 'off';
  }, [sound, volume]);
  const posters = game.coverImage?.sources.webp;
  const transparent = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';
  const poster = transparentPoster
    ? transparent
    : (posters?.find((item) => item.width >= 640)?.path ?? posters?.at(-1)?.path ?? game.coverUrl ?? undefined);
  const { trailerUrl, title } = game;
  useEffect(() => {
    if (!trailerUrl) return;
    const video = trailerVideo(trailerUrl);
    video.setAttribute('aria-label', `${title} trailer`);
    if (poster) video.poster = poster;
    playing.current = video;
    host.current?.replaceChildren(video);
    if (video.paused) void playTrailer(video);
    return () => {
      playing.current = null;
      stopTrailers([trailerUrl]);
    };
  }, [trailerUrl, title, poster]);
  return <span ref={host} className="game-trailer" />;
}
