import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GameTrailer } from './GameTrailer';
import { musicBus } from '../../lib/sound/context';
import { FakeAudioContext } from '../../test/audio-mock';
import { mergeShowcase } from './showcase';
import { startTrailer, stopTrailers } from './trailerVideo';
import type { GameSummary } from './types';

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
  stopTrailers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sound = 'off';
  volume = 1;
});

it('plays the one landscape trailer in portrait too, ignoring a legacy portrait cut', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const game = {
    ...mergeShowcase([])[0]!,
    trailerUrl: '/landscape.mp4',
    portraitTrailerUrl: '/portrait.mp4',
  } as GameSummary;
  const view = render(<GameTrailer game={game} />);
  const videos = view.container.querySelectorAll('video');
  expect(videos).toHaveLength(1);
  expect(videos[0]).toHaveAttribute('src', '/landscape.mp4');
  expect(play.mock.instances).toEqual([videos[0]]);
});

it('starts muted when the app is muted, follows sound, and stops on close', async () => {
  vi.useFakeTimers();
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
  expect(video.volume).toBe(1);
  expect(play).toHaveBeenCalledTimes(playCount);
  expect(pause).toHaveBeenCalledTimes(pauseCount);
  view.unmount();
  vi.advanceTimersByTime(800);
  expect(pause).toHaveBeenCalled();
  vi.useRealTimers();
  expect(video.isConnected).toBe(false);
});

// Kevin: "still no sound on game select". iOS only allows sound when play() starts inside the selecting tap, so the
// tap starts the very element the trailer later shows, unmuted, and the trailer must not replace or restart it.
it('plays with sound from the selecting tap and keeps that element', async () => {
  sound = 'tap';
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) {
    return !play.mock.instances.includes(this);
  });
  const game = { ...mergeShowcase([])[0]!, trailerUrl: '/trailer.mp4' };
  startTrailer(game);
  expect(play).toHaveBeenCalledOnce();
  const started = play.mock.instances[0] as unknown as HTMLVideoElement;
  expect(started.muted).toBe(false);
  const view = render(<GameTrailer game={game} />);
  expect(view.container.querySelector('video')).toBe(started);
  expect(play).toHaveBeenCalledOnce();
});

it('attaches a trailer before starting playback on mount', () => {
  const attached: boolean[] = [];
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    attached.push(this.parentElement?.classList.contains('game-trailer') ?? false);
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  render(<GameTrailer game={{ ...mergeShowcase([])[0]!, trailerUrl: '/trailer.mp4' }} />);
  expect(attached).toEqual([true]);
});

it('falls back to muted when the browser refuses sound without a gesture', async () => {
  sound = 'on';
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'))
    .mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const game = { ...mergeShowcase([])[0]!, trailerUrl: '/trailer.mp4' };
  const view = render(<GameTrailer game={game} />);
  await act(async () => {});
  expect(play).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector('video')!.muted).toBe(true);
});

it('does not restart a stopped trailer after a delayed rejection', async () => {
  sound = 'on';
  let rejectPlay!: (reason: DOMException) => void;
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectPlay = reject;
      }),
  );
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  startTrailer({ trailerUrl: '/slow.mp4' });
  stopTrailers();
  rejectPlay(new DOMException('no gesture', 'NotAllowedError'));
  await act(async () => {});
  expect(play).toHaveBeenCalledOnce();
});

it('selecting another game stops the previous trailer after its fade', () => {
  vi.useFakeTimers();
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const first = { ...mergeShowcase([])[0]!, trailerUrl: '/first.mp4' };
  startTrailer(first);
  const firstVideo = vi.mocked(HTMLMediaElement.prototype.play).mock.instances[0];
  startTrailer({ ...first, trailerUrl: '/second.mp4' });
  const secondVideo = vi.mocked(HTMLMediaElement.prototype.play).mock.instances[1] as HTMLVideoElement;
  secondVideo.dispatchEvent(new Event('playing'));
  expect(pause.mock.instances).not.toContain(firstVideo);
  vi.advanceTimersByTime(800);
  expect(pause.mock.instances).toContain(firstVideo);
  vi.useRealTimers();
});

// The black frame Kevin saw was the video before its first frame; it stays invisible over the cover until it plays.
it('marks the video only once it is playing', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const game = { ...mergeShowcase([])[0]!, trailerUrl: '/trailer.mp4' };
  const view = render(<GameTrailer game={game} transparentPoster />);
  const video = view.container.querySelector('video')!;
  expect(video).not.toHaveAttribute('data-playing');
  video.dispatchEvent(new Event('playing'));
  expect(video).toHaveAttribute('data-playing');
});


it('ramps the menu and trailer gains in opposite directions on select and close', () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const before = FakeAudioContext.last!.gains.length;
  startTrailer({ trailerUrl: '/fade.mp4' });
  const trailerGain = FakeAudioContext.last!.gains[before]!;
  const video = vi.mocked(HTMLMediaElement.prototype.play).mock.instances.at(-1) as HTMLVideoElement;
  expect(trailerGain.gain.setTargetAtTime).not.toHaveBeenCalled();
  video.dispatchEvent(new Event('playing'));
  expect(trailerGain.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.15);
  expect(vi.mocked(musicBus.gain.setTargetAtTime)).toHaveBeenLastCalledWith(0, 0, 0.15);
  stopTrailers();
  expect(trailerGain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.15);
  expect(vi.mocked(musicBus.gain.setTargetAtTime)).toHaveBeenLastCalledWith(0.5, 0, 0.15);
  vi.advanceTimersByTime(800);
  vi.useRealTimers();
});

it('keeps the first trailer audible while its replacement buffers', () => {
  vi.useFakeTimers();
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  startTrailer({ trailerUrl: '/first-buffer.mp4' });
  const first = play.mock.instances[0] as HTMLVideoElement;
  first.dispatchEvent(new Event('playing'));
  startTrailer({ trailerUrl: '/second-buffer.mp4' });
  vi.advanceTimersByTime(1000);
  expect(pause.mock.instances).not.toContain(first);
  const second = play.mock.instances[1] as HTMLVideoElement;
  second.dispatchEvent(new Event('playing'));
  vi.advanceTimersByTime(800);
  expect(pause.mock.instances).toContain(first);
  stopTrailers();
  vi.advanceTimersByTime(800);
  vi.useRealTimers();
});

it('restores the menu when a replacement trailer cannot play', async () => {
  vi.useFakeTimers();
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValueOnce().mockRejectedValueOnce(new Error('failed'));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  startTrailer({ trailerUrl: '/first-failure.mp4' });
  (play.mock.instances[0] as HTMLVideoElement).dispatchEvent(new Event('playing'));
  startTrailer({ trailerUrl: '/failed.mp4' });
  await act(async () => {});
  expect(vi.mocked(musicBus.gain.setTargetAtTime)).toHaveBeenLastCalledWith(0.5, 0, 0.15);
  vi.advanceTimersByTime(800);
  vi.useRealTimers();
});

it('restores an outgoing trailer when it is selected again while the next buffers', () => {
  vi.useFakeTimers();
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
  startTrailer({ trailerUrl: '/again-a.mp4' });
  const first = play.mock.instances[0] as HTMLVideoElement;
  document.body.appendChild(first);
  first.dispatchEvent(new Event('playing'));
  startTrailer({ trailerUrl: '/again-b.mp4' });
  stopTrailers(['/again-a.mp4']);
  expect(first.style.opacity).toBe('0');
  startTrailer({ trailerUrl: '/again-a.mp4' });
  expect(first.style.opacity).toBe('0');
  const view = render(<GameTrailer game={{ ...mergeShowcase([])[0]!, trailerUrl: '/again-a.mp4' }} />);
  expect(first.style.opacity).toBe('');
  expect(vi.mocked(musicBus.gain.setTargetAtTime)).toHaveBeenLastCalledWith(0, 0, 0.15);
  view.unmount();
  stopTrailers();
  vi.advanceTimersByTime(800);
  vi.useRealTimers();
});

it('fades to a previously blocked trailer after sound is enabled', async () => {
  sound = 'on';
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
    .mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'))
    .mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const view = render(<GameTrailer game={{ ...mergeShowcase([])[0]!, trailerUrl: '/blocked.mp4' }} />);
  await act(async () => {});
  const video = view.container.querySelector('video')!;
  expect(play).toHaveBeenCalledTimes(2);
  video.dispatchEvent(new Event('playing'));
  expect(vi.mocked(musicBus.gain.setTargetAtTime)).toHaveBeenLastCalledWith(0.5, 0, 0.15);
  sound = 'off';
  await act(async () => notify());
  sound = 'on';
  await act(async () => notify());
  expect(video.muted).toBe(false);
  expect(vi.mocked(musicBus.gain.setTargetAtTime)).toHaveBeenLastCalledWith(0, 0, 0.15);
});

it('clears a closed trailer selection before the next trailer mounts', () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const game = { ...mergeShowcase([])[0]!, trailerUrl: '/closed-a.mp4' };
  const first = render(<GameTrailer game={game} />);
  const oldVideo = first.container.querySelector('video')!;
  first.unmount();
  expect(oldVideo).not.toHaveAttribute('aria-label');
  const second = render(<GameTrailer game={{ ...game, trailerUrl: '/closed-b.mp4' }} />);
  const nextVideo = second.container.querySelector('video')!;
  nextVideo.dispatchEvent(new Event('playing'));
  expect(vi.mocked(musicBus.gain.setTargetAtTime)).toHaveBeenLastCalledWith(0, 0, 0.15);
  second.unmount();
  vi.advanceTimersByTime(800);
  vi.useRealTimers();
});
