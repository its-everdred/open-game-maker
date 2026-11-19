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
});
