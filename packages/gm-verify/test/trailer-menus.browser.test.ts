import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { launch } from '../src/browser.js';
import type { HookDriver } from '../src/hooks.js';
import { scriptedCanvasFrames } from '../src/trailer-frames.js';
import { visibleMenu } from '../src/trailer-menus.js';

const none = { selectors: [], routes: [] };

it('tells a visible menu from a hidden one, by marker, manifest selector or route', async () => {
  const browser = await launch(true, true);
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div data-gm-menu hidden>Pause</div><div data-screen="play">board</div><div data-screen="title" style="display:none">Title</div>',
    );
    expect(await visibleMenu(page, none)).toBeNull();
    expect(await visibleMenu(page, { selectors: ["[data-screen='title']"], routes: [] })).toBeNull();
    expect(await visibleMenu(page, { selectors: ["[data-screen='play']"], routes: [] })).toBe("[data-screen='play']");
    await page.evaluate(() => document.querySelector('[data-gm-menu]')!.removeAttribute('hidden'));
    expect(await visibleMenu(page, none)).toBe('[data-gm-menu]');
    await page.evaluate(() => (location.hash = '#menu'));
    expect(await visibleMenu(page, { selectors: [], routes: ['#menu'] })).toBe('#menu');
  } finally {
    await browser.close();
  }
});

it('stops the capture at the first menu frame so a trailer is gameplay only', async () => {
  const browser = await launch(true, true);
  const dir = mkdtempSync(join(tmpdir(), 'trailer-menu-'));
  try {
    const page = await browser.newPage();
    await page.clock.install({ time: new Date(0) });
    await page.setContent('<canvas width="2" height="2"></canvas>');
    await page.clock.pauseAt(100);
    await page.evaluate(() => {
      const state = window as unknown as { __gm: unknown };
      state.__gm = { inject() {}, advanceForTrailer() {}, renderTrailer() {} };
      // A round ends at 0.5 s and the game shows its results menu.
      setTimeout(() => {
        const menu = document.createElement('div');
        menu.dataset.gmMenu = '';
        menu.textContent = 'Results';
        document.body.append(menu);
      }, 500);
    });
    const hooks = { page, game: page } as unknown as HookDriver;
    await expect(scriptedCanvasFrames(hooks, [], 1, 4, dir, none)).rejects.toThrow(
      'menu [data-gm-menu] is showing at 0.50 s',
    );
    expect(readdirSync(dir)).toHaveLength(3);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
