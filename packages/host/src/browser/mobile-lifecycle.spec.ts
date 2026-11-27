import { expect, test, type Page } from '@playwright/test';

import type { GameFrame } from '../frame.js';

type Snapshot = { tick: number; state: { players: Record<string, { position: number[] }> } };

async function request(page: Page, type: 'test.renderGameToText' | 'test.advanceTime', payload: object) {
  return page.evaluate(
    ({ type, payload }) => (window.__host as unknown as { frame: GameFrame }).frame.request(type, payload as never),
    { type, payload },
  );
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`${viewport.width}x${viewport.height}: host launches, pauses and resumes a real game`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      await page.goto('/?template=game-3d');
      await expect.poll(() => page.evaluate(() => window.__host.ready[0]?.id), { timeout: 60_000 }).toBe('game-3d');
      await page.evaluate(() => (window.__host as unknown as { frame: GameFrame }).frame.setMode('play'));
      await request(page, 'test.advanceTime', { ms: 17 });
      const initial = (await request(page, 'test.renderGameToText', {})) as Snapshot;
      const move = page.getByRole('button', { name: 'move' });
      await expect(move).toBeVisible();
      const box = await move.boundingBox();
      expect(box).not.toBeNull();
      const x = box!.x + box!.width / 2;
      const y = box!.y + box!.height / 2;
      await move.dispatchEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
      });
      await move.dispatchEvent('pointermove', {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x + 30,
        clientY: y,
      });
      await request(page, 'test.advanceTime', { ms: 500 });
      await move.dispatchEvent('pointerup', {
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x + 30,
        clientY: y,
      });
      const playing = (await request(page, 'test.renderGameToText', {})) as Snapshot;
      expect(playing.tick).toBeGreaterThan(initial.tick);
      const position = (snapshot: Snapshot) => {
        const player = Object.values(snapshot.state.players)[0];
        if (!player) throw new Error('game has no player');
        return [player.position[0], player.position[2]];
      };
      expect(position(playing)).not.toEqual(position(initial));

      await page.evaluate(() => (window.__host as unknown as { frame: GameFrame }).frame.send('lifecycle.pause', {}));
      await request(page, 'test.advanceTime', { ms: 500 });
      const paused = (await request(page, 'test.renderGameToText', {})) as Snapshot;
      expect(paused.tick).toBe(playing.tick);
      expect(position(paused)).toEqual(position(playing));

      await page.evaluate(() => (window.__host as unknown as { frame: GameFrame }).frame.send('lifecycle.resume', {}));
      await request(page, 'test.advanceTime', { ms: 500 });
      const resumed = (await request(page, 'test.renderGameToText', {})) as Snapshot;
      expect(resumed.tick).toBeGreaterThan(paused.tick);
      expect(await page.evaluate(() => window.__host.errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
