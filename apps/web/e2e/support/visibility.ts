import type { Frame, Page } from '@playwright/test';

// eslint-disable-next-line no-restricted-properties
const bridgePort = process.env.OGM_WEB_BRIDGE_PORT ?? '10001';
export const bridgeOrigin = `http://127.0.0.1:${bridgePort}`;

export function bridgeState(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () => (window as Window & { __ogmHost?: { game?: { bridgeState: string } } }).__ogmHost?.game?.bridgeState,
  );
}

export function gameFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame.url().startsWith(`${bridgeOrigin}/d/`));
}

/** Emulates the browser hiding and showing the tab, in the shell and in the game frame alike. */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  const frame = gameFrame(page);
  for (const target of frame ? [page.mainFrame(), frame] : [page.mainFrame()]) {
    await target.evaluate((value) => {
      if (value) {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      } else {
        Reflect.deleteProperty(document, 'visibilityState');
        Reflect.deleteProperty(document, 'hidden');
      }
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  }
}
