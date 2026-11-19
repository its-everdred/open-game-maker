import { status } from '../../lib/sound';
import { ctx, musicBus, node, ramp, trailerBus } from '../../lib/sound/context';
import type { GameSummary } from './types';

type TrailerGame = Pick<GameSummary, 'trailerUrl'>;

// The selecting gesture starts the same element that GameTrailer later adopts on iOS.
const videos = new Map<string, HTMLVideoElement>();
const gains = new WeakMap<HTMLVideoElement, GainNode>();
const fadeSeconds = 0.6;
let selectedUrl: string | undefined;

function fadeMenu(trailerActive: boolean): void {
  ramp(musicBus, trailerActive ? 0 : 0.5, fadeSeconds);
}

// Keep outgoing media in the document while React removes its original host.
function preserve(video: HTMLVideoElement): void {
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
}

function retire(url: string, video: HTMLVideoElement): void {
  videos.delete(url);
  const gain = gains.get(video);
  if (gain) ramp(gain, 0, fadeSeconds);
  preserve(video);
  window.setTimeout(() => {
    video.pause();
    video.remove();
    gain?.disconnect();
  }, fadeSeconds * 1000 + 200);
}

function activate(url: string, video: HTMLVideoElement): void {
  if (selectedUrl !== url || videos.get(url) !== video) return;
  const gain = gains.get(video);
  if (gain) ramp(gain, 1, fadeSeconds);
  fadeMenu(!video.muted || status() === 'off');
  for (const [other, outgoing] of videos) if (other !== url) retire(other, outgoing);
}

export function trailerVideo(url: string): HTMLVideoElement {
  let video = videos.get(url);
  if (!video) {
    video = document.createElement('video');
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = url;
    const gain = node(trailerBus, 0);
    ctx.createMediaElementSource(video).connect(gain);
    gains.set(video, gain);
    const shown = video;
    shown.addEventListener('playing', () => {
      shown.setAttribute('data-playing', '');
      activate(url, shown);
    });
    videos.set(url, video);
  }
  return video;
}

export function activeTrailerUrl(game: TrailerGame): string | undefined {
  return game.trailerUrl ?? undefined;
}

/** Apply sound changes to an already playing trailer, including an autoplay-muted fallback. */
export function syncTrailerSound(video: HTMLVideoElement, muted: boolean): void {
  video.muted = muted;
  if (video.hasAttribute('data-playing') && selectedUrl && videos.get(selectedUrl) === video) fadeMenu(true);
}

/** Plays inside a gesture when possible, falling back to muted playback if required. */
export function playTrailer(video: HTMLVideoElement): Promise<void> {
  const url = [...videos].find(([, item]) => item === video)?.[0];
  if (!url) return Promise.resolve();
  selectedUrl ??= url;
  video.muted = status() === 'off';
  if (!video.paused && video.hasAttribute('data-playing')) activate(url, video);
  return video.play().catch((error: unknown) => {
    if (selectedUrl !== url || videos.get(url) !== video) return;
    const failed = () => {
      if (selectedUrl !== url || videos.get(url) !== video) return;
      for (const [other, outgoing] of videos) retire(other, outgoing);
      fadeMenu(false);
    };
    if (!video.muted && (error as Error | undefined)?.name === 'NotAllowedError') {
      video.muted = true;
      return video.play().catch(failed);
    }
    failed();
  });
}

export function startTrailer(game: TrailerGame): void {
  const url = activeTrailerUrl(game);
  stopOtherTrailers(url);
  if (url) void playTrailer(trailerVideo(url));
}

/** Retain the outgoing audio until the new selection has started playing. */
export function stopOtherTrailers(url?: string | null): void {
  selectedUrl = url ?? undefined;
  if (!url) stopTrailers();
}

/** Fade closed trailers; an outgoing selection stays alive until its replacement plays. */
export function stopTrailers(urls?: Iterable<string | null | undefined>): void {
  if (!urls) selectedUrl = undefined;
  for (const url of urls ?? [...videos.keys()]) {
    const video = url ? videos.get(url) : undefined;
    if (!url || !video) continue;
    if (selectedUrl && selectedUrl !== url) {
      preserve(video);
      continue;
    }
    retire(url, video);
  }
  if (!selectedUrl || videos.size === 0) fadeMenu(false);
}
