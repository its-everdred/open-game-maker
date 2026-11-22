import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';

const here = fileURLToPath(new URL('.', import.meta.url));

test('renders overlapping walls independently and positions an elevated roof', async ({ page }) => {
  const bundle = await build({
    entryPoints: [`${here}/overlap-scene.ts`],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  await page.setContent(`<!doctype html><body><script>${bundle.outputFiles[0]!.text}</script></body>`);
  await page.waitForFunction(() => 'overlap' in window);
  const result = await page.evaluate(
    () =>
      (
        window as unknown as {
          overlap: { before: { key: string; y: number }[]; after: boolean[]; collision: boolean[][]; renderer: number };
        }
      ).overlap,
  );
  expect(result.renderer).toBe(2);
  expect(result.before).toHaveLength(3);
  expect(new Set(result.before.map(({ key }) => key)).size).toBe(3);
  expect(result.before.map(({ y }) => y)).toEqual([64, 64, -48]);
  expect(result.after).toEqual([false, true, true]);
  expect(result.collision).toEqual([[true]]);
});
