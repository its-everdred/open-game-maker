import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
let server: Server;
let origin: string;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    const file = [join(dist, path), join(dist, path, 'index.html')].find(
      (candidate) => candidate.startsWith(dist) && existsSync(candidate) && statSync(candidate).isFile(),
    );
    if (!file) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('built factory loads artwork, switches orientation, and loops the conveyor', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) errors.push(response.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await expect(page.locator('#cargo > *')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Vertical' }).click();
  await expect(page.locator('#set-v')).toBeVisible();
  await expect(page.locator('#set-h')).toBeHidden();
  expect(errors).toEqual([]);
  const offset = await page.locator('#cargo').evaluate((cargo) => {
    const animation = cargo.getAnimations().find((entry) => entry.animationName === 'carry');
    if (!animation) throw new Error('conveyor animation missing');
    const children = [...cargo.children];
    const first = children[0]!;
    const repeat = children[children.length / 2]!;
    animation.pause();
    animation.currentTime = 0;
    const start = repeat.getBoundingClientRect().left;
    animation.currentTime = 79_999;
    const end = first.getBoundingClientRect().left;
    return Math.abs(start - end);
  });
  expect(offset).toBeLessThan(1);
});

test('unrelated campaign parameters do not activate preview controls', async ({ page }) => {
  await page.goto(`${origin}/?utm_source=advertising&campaign=stillness`, { waitUntil: 'networkidle' });
  await expect(page.locator('#set-h')).toBeVisible();
  await expect(page.locator('#set-v')).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/still/);
});
