import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GameTrailer } from './GameTrailer';
import { mergeShowcase } from './showcase';

let sound = 'off';
let volume = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
vi.mock('../../lib/sound', () => ({
  status: () => sound,
  getVolume: () => volume,
  onChange: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sound = 'off';
  volume = 1;
});

it('switches playback when the device rotates', async () => {
  let rotate = () => {};
  const media = {
    matches: false,
    addEventListener: (_event: string, listener: () => void) => {
      rotate = listener;
    },
    removeEventListener: () => {},
  };
  vi.stubGlobal('matchMedia', () => media);
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const game = { ...mergeShowcase([])[0]!, trailerUrl: '/landscape.mp4', portraitTrailerUrl: '/portrait.mp4' };
  const view = render(<GameTrailer game={game} />);
  const landscape = view.container.querySelector<HTMLVideoElement>('.game-trailer-landscape')!;
  const portrait = view.container.querySelector<HTMLVideoElement>('.game-trailer-portrait')!;
  expect(play.mock.instances).toContain(landscape);
  media.matches = true;
  await act(async () => rotate());
  expect(pause.mock.instances).toContain(landscape);
  expect(play.mock.instances).toContain(portrait);
});

it('starts muted, follows sound, and stops on close', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const game = { ...mergeShowcase([])[0]!, coverUrl: '/poster.png', trailerUrl: '/trailer.mp4' };
  const view = render(<GameTrailer game={game} />);
  const video = view.container.querySelector('video')!;
  await act(async () => {});
  expect(play).toHaveBeenCalled();
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  expect(video.poster).toContain('/poster.png');
  sound = 'on';
  await act(async () => notify());
  expect(video.muted).toBe(false);
  const playCount = play.mock.calls.length;
  const pauseCount = pause.mock.calls.length;
  volume = 0.25;
  await act(async () => notify());
  expect(video.volume).toBe(0.25);
  expect(play).toHaveBeenCalledTimes(playCount);
  expect(pause).toHaveBeenCalledTimes(pauseCount);
  view.unmount();
  expect(pause).toHaveBeenCalled();
});
