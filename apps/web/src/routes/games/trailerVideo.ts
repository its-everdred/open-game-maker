import { getVolume, status } from '../../lib/sound';
import type { GameSummary } from './types';

type TrailerGame = Pick<GameSummary, 'trailerUrl'>;

// One video per trailer URL, created by the tap that selects a game and adopted by GameTrailer when it mounts:
// iOS only plays a video with sound when its play() call starts inside a user gesture.
const videos = new Map<string, HTMLVideoElement>();

export function trailerVideo(url: string): HTMLVideoElement {
  let video = videos.get(url);
  if (!video) {
    video = document.createElement('video');
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    const shown = video;
    shown.addEventListener('playing', () => shown.setAttribute('data-playing', ''));
    videos.set(url, video);
  }
  return video;
}

export function activeTrailerUrl(game: TrailerGame): string | undefined {
  return game.trailerUrl ?? undefined;
}

/** Plays with sound unless the app is muted; falls back to muted when the browser refuses (no gesture). */
export function playTrailer(video: HTMLVideoElement): Promise<void> {
  video.volume = getVolume();
  video.muted = status() === 'off';
  return video.play().catch((error: unknown) => {
    if (video.muted || (error as Error | undefined)?.name !== 'NotAllowedError') return;
    video.muted = true;
    return video.play().catch(() => {});
  });
}

/** Call inside the tap or key press that selects a game. */
export function startTrailer(game: TrailerGame): void {
  const url = activeTrailerUrl(game);
  stopTrailers([...videos.keys()].filter((other) => other !== url));
  if (url) void playTrailer(trailerVideo(url));
}

/** Stops and forgets these trailers (every trailer by default), so nothing plays after its game is closed. */
export function stopTrailers(urls: Iterable<string | null | undefined> = [...videos.keys()]): void {
  for (const url of urls) {
    const video = url ? videos.get(url) : undefined;
    if (!video) continue;
    video.pause();
    video.remove();
    videos.delete(url!);
  }
}
