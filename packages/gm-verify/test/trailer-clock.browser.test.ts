import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { launch } from '../src/browser.js';
import type { HookDriver } from '../src/hooks.js';
import { scriptedCanvasFrames } from '../src/trailer-frames.js';

it('advances game timers with trailer time at different frame rates', async () => {
  const browser = await launch(true, true);
  const dir = mkdtempSync(join(tmpdir(), 'trailer-clock-'));
  try {
    for (const fps of [1, 10]) {
      const page = await browser.newPage();
      await page.clock.install({ time: new Date(0) });
      await page.setContent('<canvas width="2" height="2"></canvas>');
      await page.clock.pauseAt(100);
      await page.evaluate(() => {
        const state = window as unknown as { __gmTrailerAudio: { timeMs: number }; __gm: unknown; fired: number };
        state.__gmTrailerAudio = { timeMs: 0 };
        state.fired = -1;
        state.__gm = { inject() {}, advanceForTrailer() {}, renderTrailer() {} };
        setTimeout(() => {
          state.fired = state.__gmTrailerAudio.timeMs;
        }, 500);
      });
      const hooks = { page, game: page } as unknown as HookDriver;
      await scriptedCanvasFrames(hooks, [], 1, fps, dir);
      const fired = await page.evaluate(() => (window as unknown as { fired: number }).fired);
      expect(fired).toBeGreaterThanOrEqual(490);
      expect(fired).toBeLessThanOrEqual(520);
      await page.close();
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
