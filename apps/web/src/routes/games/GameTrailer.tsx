import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getVolume, onChange, status } from '../../lib/sound';
import { activeTrailerUrl, playTrailer, stopTrailers, trailerVideo } from './trailerVideo';
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
  const { portraitTrailerUrl, trailerUrl, title } = game;
  useEffect(() => {
    const both = portraitTrailerUrl && trailerUrl;
    const urls = [portraitTrailerUrl, trailerUrl];
    const orientation = window.matchMedia?.('(orientation: portrait)');
    const update = () => {
      const active = activeTrailerUrl({ portraitTrailerUrl, trailerUrl });
      const videos = urls.flatMap((url) => {
        if (!url) return [];
        const video = trailerVideo(url);
        if (both) video.className = url === portraitTrailerUrl ? 'game-trailer-portrait' : 'game-trailer-landscape';
        video.setAttribute('aria-label', `${title} trailer`);
        if (poster) video.poster = poster;
        if (url === active) {
          playing.current = video;
          // A tap that selected the game has already started it with sound.
          if (video.paused) void playTrailer(video);
        } else video.pause();
        return [video];
      });
      host.current?.replaceChildren(...videos);
    };
    update();
    orientation?.addEventListener('change', update);
    return () => {
      orientation?.removeEventListener('change', update);
      playing.current = null;
      stopTrailers(urls);
    };
  }, [portraitTrailerUrl, trailerUrl, title, poster]);
  return <span ref={host} className="game-trailer" />;
}
