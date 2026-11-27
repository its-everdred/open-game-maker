import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureSaveThumbnail, createSaveThumbnailCache } from './thumbnail.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('save thumbnail', () => {
  it('captures the largest game canvas at a bounded size', () => {
    const small = document.createElement('canvas');
    small.width = 100;
    small.height = 100;
    const source = document.createElement('canvas');
    source.width = 800;
    source.height = 450;
    document.body.append(small, source);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 1, 0, 0, 255]) }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,YWJj');
    expect(captureSaveThumbnail()).toBe('data:image/webp;base64,YWJj');
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 160, 90);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      drawImage: () => {
        throw new Error('tainted');
      },
    } as unknown as CanvasRenderingContext2D);
    expect(captureSaveThumbnail()).toBeUndefined();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0]) }),
    } as unknown as CanvasRenderingContext2D);
    expect(captureSaveThumbnail()).toBeUndefined();
  });

  it('samples after frame callbacks, throttles capture, and stops on disposal', async () => {
    let frame!: () => void;
    let time = 0;
    let pixels = 'before';
    const stop = vi.fn();
    const capture = vi.fn(() => pixels);
    const cache = createSaveThumbnailCache({
      onFrame: (callback) => {
        frame = callback;
        return stop;
      },
      capture,
      now: () => time,
    });
    frame();
    pixels = 'after';
    await Promise.resolve();
    expect(cache.current()).toBe('after');
    frame();
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);
    time = 2_000;
    frame();
    cache.dispose();
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps recent stills for the bug report offsets', async () => {
    let frame!: () => void;
    let time = 0;
    let image = 'still-0';
    const cache = createSaveThumbnailCache({
      onFrame: (callback) => {
        frame = callback;
        return () => undefined;
      },
      capture: () => image,
      now: () => time,
    });

    for (time = 0; time <= 10_000; time += 1_000) {
      image = `still-${time}`;
      frame();
      await Promise.resolve();
    }
    time = 10_000;

    expect(cache.atOffset(0)).toEqual({ at: 10_000, image: 'still-10000' });
    expect(cache.atOffset(5_000)).toEqual({ at: 5_000, image: 'still-5000' });
    expect(cache.atOffset(10_000)).toEqual({ at: 0, image: 'still-0' });
    cache.dispose();
  });

  it('timestamps successful captures and keeps a margin for missed samples', async () => {
    let frame!: () => void;
    let time = 0;
    let sequence = 0;
    const cache = createSaveThumbnailCache({
      onFrame: (callback) => {
        frame = callback;
        return () => undefined;
      },
      capture: () => {
        time += 100;
        return `still-${sequence++}`;
      },
      now: () => time,
    });

    for (let sample = 0; sample < 15; sample += 1) {
      frame();
      await Promise.resolve();
      time += 1_000;
    }

    expect(cache.atOffset(0)).toEqual({ at: 15_500, image: 'still-14' });
    expect(cache.atOffset(10_000)).toEqual({ at: 5_600, image: 'still-5' });
    cache.dispose();
  });

  it('freezes gameplay history at pause and rejects expired samples while running', async () => {
    let frame!: () => void;
    let time = 0;
    let image = 'still-0';
    const capture = vi.fn(() => image);
    const cache = createSaveThumbnailCache({
      onFrame: (callback) => {
        frame = callback;
        return () => undefined;
      },
      capture,
      now: () => time,
    });

    for (time = 0; time <= 10_000; time += 1_000) {
      image = `still-${time}`;
      frame();
      await Promise.resolve();
    }
    time = 10_000;
    image = 'paused-frame';
    cache.pause();
    time = 30_000;
    frame();

    expect(cache.atOffset(0)).toEqual({ at: 10_000, image: 'paused-frame' });
    expect(cache.atOffset(5_000)).toEqual({ at: 5_000, image: 'still-5000' });
    expect(cache.atOffset(10_000)).toEqual({ at: 0, image: 'still-0' });
    cache.resume();
    expect(cache.atOffset(0)).toBeUndefined();
    cache.dispose();
  });

  it('does not relabel an older frame with the pause time when pause capture fails', async () => {
    let frame!: () => void;
    let time = 0;
    let pauseCaptureFails = false;
    const cache = createSaveThumbnailCache({
      onFrame: (callback) => {
        frame = callback;
        return () => undefined;
      },
      capture: () => (pauseCaptureFails ? undefined : `still-${time}`),
      now: () => time,
    });

    for (time = 0; time <= 3_000; time += 1_000) {
      frame();
      await Promise.resolve();
    }
    time = 5_000;
    pauseCaptureFails = true;
    cache.pause();

    expect(cache.atOffset(0)).toEqual({ at: 3_000, image: 'still-3000' });
    cache.dispose();
  });
});
