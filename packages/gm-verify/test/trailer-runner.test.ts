import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

vi.mock('../src/browser.js', () => ({
  launch: async () => ({ close: async () => {} }),
  openGame: async () => ({
    hooks: {},
    game: { evaluate: async () => ({ sdk: true, events: [], unsupported: [] }) },
    close: async () => {},
  }),
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
