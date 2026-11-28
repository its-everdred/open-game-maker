import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { hostFrameUrl, launch } from '../src/browser.js';
import { serveStatic } from '../src/server.js';

const shellDir = fileURLToPath(new URL('../dist/shell/', import.meta.url));
const gameDir = fileURLToPath(new URL('../fixtures/stub-game/', import.meta.url));
let shell: Awaited<ReturnType<typeof serveStatic>>;
let game: Awaited<ReturnType<typeof serveStatic>>;
beforeAll(async () => {
  shell = await serveStatic(shellDir);
  game = await serveStatic(gameDir);
});
afterAll(async () => {
  await shell.close();
  await game.close();
});

it.each([
  { width: 390, height: 844 },
  { width: 1180, height: 820 },
])('fills the $width x $height play viewport with the game and one menu control', async (viewport) => {
  const browser = await launch(process.env.GM_VERIFY_SOFTWARE_GL === '1');
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(hostFrameUrl(shell.url, game.url, 'mobile', 'Test game'));
    const stage = await page.locator('.game-stage').boundingBox();
    expect(stage).toEqual({ x: 0, y: 0, ...viewport });
    expect(await page.locator('.game-frame iframe').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Menu' }).count()).toBe(1);
    expect(await page.locator('.play-bar').count()).toBe(0);
  } finally {
    await browser.close();
  }
});

it.each([
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])('keeps Back and Menu aligned in the phone shell at $width x $height', async (viewport) => {
  const browser = await launch(process.env.GM_VERIFY_SOFTWARE_GL === '1');
  try {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(() => {
      if (window.parent === window) return;
      let connected = false;
      const sendHello = () =>
        window.parent.postMessage(JSON.stringify({ v: 1, id: 'hello', t: 'hello', payload: { protocol: 1 } }), '*');
      const timer = setInterval(sendHello, 100);
      window.addEventListener('message', (event) => {
        if (connected || !event.ports[0]) return;
        connected = true;
        clearInterval(timer);
        const port = event.ports[0];
        port.onmessage = ({ data }) => {
          if (JSON.parse(data).t === 'navigation.back') document.body.dataset.backReceived = 'true';
        };
        const send = (t: string, payload: unknown) => port.postMessage(JSON.stringify({ v: 1, id: t, t, payload }));
        send('ready', {
          protocol: 1,
          marks: [],
          firstFrameSignal: true,
          manifest: {
            id: 'host-test',
            sdk: '^1.0.0',
            title: 'Host Test',
            inputs: { actions: {} },
            presentation: { orientation: 'landscape', minLogical: { w: 640, h: 360 }, fit: 'responsive' },
            view: 'iso',
            dimension: '3d',
            capabilities: [],
            palette: { categories: [], items: [] },
            tools: [],
            gizmos: {},
            saves: false,
            overrides: { aliases: {}, retired: [] },
          },
        });
        send('host.back', { enabled: true });
        send('load.frame', {});
      });
      sendHello();
    });
    await page.goto(hostFrameUrl(shell.url, game.url, 'mobile', 'Test game'));
    const back = page.getByRole('button', { name: 'Back' });
    await back.waitFor({ state: 'visible' });
    const menu = page.getByRole('button', { name: 'Menu' });
    const backBox = await back.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(backBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(backBox!.y).toBe(menuBox!.y);
    expect(backBox!.width).toBe(menuBox!.width);
    expect(backBox!.height).toBe(menuBox!.height);
    expect(backBox!.x).toBeLessThan(menuBox!.x);
    await back.click();
    await expect
      .poll(() => page.locator('iframe').contentFrame().locator('body').getAttribute('data-back-received'))
      .toBe('true');
    expect(await back.evaluate((element) => getComputedStyle(element).borderColor)).toBe(
      await menu.evaluate((element) => getComputedStyle(element).borderColor),
    );
  } finally {
    await browser.close();
  }
});
