import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { CANVAS_FRAME_CHUNK, clipArgs, nativeClipArgs, nativeUpscale, record } from '../src/capture.js';
import type { HookDriver } from '../src/hooks.js';

/* `true` accepts any arguments and prints nothing: it stands in for ffmpeg so no encoder runs here. */
const FAKE_FFMPEG = 'true';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function fakeHooks(passes = 1, dropOne = false) {
  const evaluate = vi.fn(async (_fn: unknown, options: { count: number }) => ({
    frames: Array.from({ length: options.count - (dropOne ? 1 : 0) }, () => PIXEL),
    width: 480,
    height: 300,
  }));
  const screenshot = vi.fn(async () => Buffer.alloc(0));
  const hooks = {
    passes,
    renderAt: vi.fn(async () => {}),
    // Stills are of the page (the whole app shell); the canvas is read where the game runs (its frame in the shell).
    page: { screenshot, viewportSize: () => ({ width: 1440, height: 900 }) },
    game: { locator: vi.fn(() => ({ evaluate })) },
  };
  return { hooks: hooks as unknown as HookDriver, evaluate, screenshot };
}

const outPath = () => join(mkdtempSync(join(tmpdir(), 'gm-record-')), 'run.mp4');

describe('record', () => {
  it('keeps the default clip on whole-page screenshots at 30 fps, so existing games record as before', async () => {
    const { hooks, evaluate, screenshot } = fakeHooks();

    await record(hooks, { seconds: 2 }, outPath(), FAKE_FFMPEG);

    expect(screenshot).toHaveBeenCalledTimes(60);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('reads every native frame from the canvas at the requested rate, in bounded chunks', async () => {
    const { hooks, evaluate, screenshot } = fakeHooks();

    await record(hooks, { seconds: 4, fps: 60, native: true }, outPath(), FAKE_FFMPEG);

    const chunks = evaluate.mock.calls.map(([, options]) => options as { first: number; count: number });
    expect(chunks.reduce((sum, { count }) => sum + count, 0)).toBe(240);
    expect(chunks.map(({ first }) => first)).toEqual([0, 60, 120, 180]);
    expect(Math.max(...chunks.map(({ count }) => count))).toBeLessThanOrEqual(CANVAS_FRAME_CHUNK);
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('fails a native recording when the canvas returns fewer frames than requested', async () => {
    const { hooks } = fakeHooks(1, true);

    await expect(record(hooks, { seconds: 1, fps: 30, native: true }, outPath(), FAKE_FFMPEG)).rejects.toThrow(
      'canvas returned 29 of 30 frames',
    );
  });

  it('renders each native frame twice for a follow camera, as stills do', async () => {
    const { hooks, evaluate } = fakeHooks(2);

    await record(hooks, { seconds: 1, native: true }, outPath(), FAKE_FFMPEG);
    expect(evaluate.mock.calls[0]![1]).toMatchObject({ passes: 2, fps: 30 });
  });
});

describe('clipArgs', () => {
  it('keeps the phone-safe 960 pixel encode', () => {
    const args = clipArgs('/frames', 30, '/out.mp4');

    expect(args).toContain('scale=960:-2:in_range=full:out_range=tv,format=yuv420p');
    expect(args).toEqual(expect.arrayContaining(['-framerate', '30', '-pix_fmt', 'yuv420p', '+faststart']));
  });
});

describe('nativeUpscale', () => {
  it('fills the viewport when it is a whole-number upscale of the canvas', () => {
    expect(nativeUpscale({ width: 480, height: 300 }, { width: 1440, height: 900 })).toEqual({
      width: 1440,
      height: 900,
    });
  });

  it('keeps the canvas size rather than downscale a high-DPR canvas or stretch a fractional one', () => {
    expect(nativeUpscale({ width: 780, height: 1688 }, { width: 390, height: 844 })).toBeUndefined();
    expect(nativeUpscale({ width: 640, height: 400 }, { width: 1440, height: 900 })).toBeUndefined();
  });
});

describe('nativeClipArgs', () => {
  it('upscales canvas frames to the viewport with nearest-neighbour sampling', () => {
    const args = nativeClipArgs('/frames', 60, '/out.mp4', { width: 1440, height: 900 });

    expect(args).toContain('scale=1440:900:flags=neighbor:in_range=full:out_range=tv,format=yuv420p');
    expect(args).toEqual(expect.arrayContaining(['-framerate', '60', '-pix_fmt', 'yuv420p', '+faststart']));
  });

  it('keeps the canvas pixel size, rounded to even for yuv420p, when no whole-number upscale applies', () => {
    expect(nativeClipArgs('/frames', 60, '/out.mp4')).toContain(
      'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=neighbor:in_range=full:out_range=tv,format=yuv420p',
    );
  });
});
