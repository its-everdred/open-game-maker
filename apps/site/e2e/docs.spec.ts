import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const html = fileURLToPath(new URL('../dist/docs-prototype/index.html', import.meta.url));
let server: Server;
let origin: string;
test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(readFileSync(html));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('switches audiences, remembers the choice and navigates on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build with your agents.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Browse docs').selectOption('skills');
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();
  await page.getByRole('button', { name: 'Human', exact: true }).click();
  await page.getByLabel('Browse docs').selectOption('create');
  await expect(page.getByRole('heading', { name: 'Create a game' })).toBeVisible();
});

test('opens direct links and navigates the desktop audience', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`${origin}/#reviews`);
  await expect(page.getByRole('heading', { name: 'Review the work' })).toBeVisible();
  await expect(page.locator('.onpage')).toBeHidden();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reviews and decisions' })).toBeVisible();
  await page.getByRole('link', { name: 'Skills', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible();
});
