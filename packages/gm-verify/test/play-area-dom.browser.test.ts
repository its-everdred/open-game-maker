import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { inspectPlayArea } from '../app-capture/play-area-dom.js';
import { GPU_ARGS, SOFTWARE_ARGS } from '../src/browser.js';

it('detects overlapping HUD and sprites, exemptions, and viewport clipping', async () => {
  const browser = await chromium.launch({ args: process.env.GM_VERIFY_SOFTWARE_GL === '1' ? SOFTWARE_ARGS : GPU_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(`<style>body { margin: 0 } #board { position: absolute; left: 50px; top: 100px; width: 200px; height: 600px }
      #header { position: absolute; top: 90px; left: 50px; width: 100px; height: 40px; background: red }</style>
      <div id="board" data-gm-play-area></div><header id="header">Score</header>`);
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('overlap: #header');
    await page.locator('#header').evaluate((header) => {
      header.style.left = '260px';
    });
    await expect(page.evaluate(inspectPlayArea, null)).resolves.toMatchObject({ board: { left: 50, top: 100 } });
    await page.locator('#header').evaluate((header) => {
      header.style.left = '50px';
      header.setAttribute('data-gm-overlay-allowed', '');
    });
    await expect(page.evaluate(inspectPlayArea, null)).resolves.toBeTruthy();
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.id = 'hud-canvas';
      canvas.style.cssText = 'position:absolute;left:50px;top:100px;width:200px;height:200px';
      document.querySelector('#board')!.before(canvas);
    });
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('overlap: #hud-canvas');
    await page.locator('#hud-canvas').evaluate((element) => element.remove());
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<svg id="hud-icon" style="position:absolute;left:60px;top:110px;width:30px;height:30px"><path d="M0 0h30v30H0z" /></svg>',
      );
    });
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('overlap: #hud-icon');
    await page.locator('#hud-icon').evaluate((element) => element.remove());
    await page.evaluate(() => {
      document.head.insertAdjacentHTML(
        'beforeend',
        '<style>#pseudo::before { content: " "; display:block; width:100%; height:100%; background:red }</style>',
      );
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="pseudo" style="position:absolute;left:60px;top:110px;width:30px;height:30px"></div>',
      );
    });
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('overlap: #pseudo');
    await page.locator('#pseudo').evaluate((element) => {
      element.style.cssText = 'position:absolute;left:60px;top:110px;width:0;height:0';
      document.head.insertAdjacentHTML(
        'beforeend',
        '<style>#pseudo::before { position:absolute; left:0; top:0; width:30px; height:30px }</style>',
      );
    });
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('overlap: #pseudo');
    await page.locator('#pseudo').evaluate((element) => {
      element.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
      document.head.insertAdjacentHTML(
        'beforeend',
        '<style>#pseudo::before { transform:translate(100px,110px) }</style>',
      );
    });
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('overlap: #pseudo');
    await page.locator('#pseudo').evaluate((element) => {
      element.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
      document.head.insertAdjacentHTML(
        'beforeend',
        '<style>#pseudo::before { position:static; transform:none; display:block; width:150px; height:150px }</style>',
      );
    });
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('overlap: #pseudo');
    await page.locator('#pseudo').evaluate((element) => element.remove());
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="behind" style="position:absolute;left:60px;top:110px;width:30px;height:30px;background:red"></div><div data-gm-overlay-allowed style="position:absolute;left:50px;top:100px;width:200px;height:600px;background:blue"></div>',
      );
    });
    await expect(page.evaluate(inspectPlayArea, null)).resolves.toBeTruthy();
    await page.locator('#behind').evaluate((element) => element.remove());
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="canvas-background" style="position:absolute;left:60px;top:110px;width:30px;height:30px;background:red"></div><canvas id="surface" data-gm-overlay-allowed data-gm-opaque style="pointer-events:none;position:absolute;left:50px;top:100px;width:200px;height:600px"></canvas>',
      );
    });
    await expect(page.evaluate(inspectPlayArea, null)).resolves.toBeTruthy();
    await page.locator('#canvas-background').evaluate((element) => element.remove());
    await page.evaluate(() => {
      (window as any).__gmUiSprites = () => [{ name: 'HOLD', left: 100, top: 100, width: 20, height: 20 }];
    });
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('overlap: HOLD');
    await page.evaluate(() => {
      delete (window as any).__gmUiSprites;
      document.querySelector<HTMLElement>('#board')!.style.top = '-1px';
    });
    await expect(page.evaluate(inspectPlayArea, null)).rejects.toThrow('clipped by viewport');
    await page.setContent(`<div class="game-frame"><iframe></iframe></div>
      <button id="shell-control" style="position:absolute;left:60px;top:110px">Menu</button>`);
    const hostBoard = { left: 50, top: 100, width: 200, height: 600 };
    await expect(page.evaluate(inspectPlayArea, hostBoard)).rejects.toThrow('overlap: #shell-control');
    await page.locator('#shell-control').evaluate((element) => element.setAttribute('data-gm-overlay-allowed', ''));
    await expect(page.evaluate(inspectPlayArea, hostBoard)).resolves.toBeTruthy();
  } finally {
    await browser.close();
  }
});
