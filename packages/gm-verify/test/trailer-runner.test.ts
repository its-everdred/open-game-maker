import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

const opened = vi.hoisted(() => [] as unknown[]);
vi.mock('../src/browser.js', () => ({
  launch: async () => ({ close: async () => {} }),
  openGame: async (_browser: unknown, _url: string, options: { contextOptions: { viewport: unknown } }) => (
    opened.push(options.contextOptions.viewport),
    {
      hooks: {},
      game: { evaluate: async () => ({ sdk: true, events: [], unsupported: [] }) },
      close: async () => {},
    }
  ),
}));
vi.mock('../src/server.js', () => ({
  serveStatic: async () => ({ url: 'http://127.0.0.1:1234/', close: async () => {} }),
}));
vi.mock('../src/semaphore.js', () => ({ acquireSlot: async () => ({ release() {} }) }));
vi.mock('../src/trailer-video.js', () => ({ recordTrailerVideo: async () => {} }));
vi.mock('../src/capture.js', () => ({ ffmpeg: () => {} }));

import { captureTrailer, trailerScriptSchema } from '../src/trailer.js';

it('refuses to publish a trailer when every scene is silent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trailer-silent-'));
  try {
    await expect(
      captureTrailer({
        serveDir: dir,
        outDir: dir,
        script: trailerScriptSchema.parse([{ seconds: 15 }]),
        software: true,
      }),
    ).rejects.toThrow('did not request audible SDK audio');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('records each scenario once, in the 16:9 landscape viewport only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trailer-once-'));
  opened.length = 0;
  try {
    await expect(
      captureTrailer({
        serveDir: dir,
        outDir: dir,
        script: trailerScriptSchema.parse([{ seconds: 8 }, { scenario: 'combo', seconds: 8 }]),
        software: true,
      }),
    ).rejects.toThrow('did not request audible SDK audio');
    expect(opened).toEqual([
      { width: 640, height: 360 },
      { width: 640, height: 360 },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
