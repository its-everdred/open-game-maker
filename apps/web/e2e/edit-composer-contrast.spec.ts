import sharp from 'sharp';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

// #1198: on the edit page the composer sits on a dark card. With only half its colour tokens set, its buttons fell
// back to aiur's light defaults and the cream icons vanished on near-white circles. Measure the rendered pixels, not
// the CSS, so any token left on a light default fails here.
const AA_NON_TEXT = 3;
const viewports = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
];

type Rgb = [number, number, number];

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

for (const viewport of viewports) {
  test(`edit composer buttons reach 3:1 at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One browser covers both phone viewports');
    await page.setViewportSize(viewport);
    await openEditPage(page);
    await page.getByRole('button', { name: 'Chat' }).click();
    const composer = page.locator('.edit-workspace-chat aiur-composer');
    await expect(composer).toBeVisible();
    await revealAllButtons(composer);

    const idle = await page.screenshot();
    await testInfo.attach(`edit-composer-${viewport.name}.png`, { body: idle, contentType: 'image/png' });
    const report = await measure(composer, idle, ['attach', 'mic', 'voice', 'send']);
    await composer.locator('textarea').fill('Make the goblins faster');
    report.push(...(await measure(composer, await page.screenshot(), ['send'], ' (enabled)')));

    const failing = report.filter((line) => line.startsWith('FAIL'));
    expect(failing, report.join('\n')).toEqual([]);
  });
}

async function openEditPage(page: Page): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css; charset=utf-8', body: '' }),
  );
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  await page.route('**/api/v1/me/commands**', (route) => route.fulfill({ json: { commands: [], sessions: [] } }));
  await page.route('**/api/v1/me/core-commands', (route) => route.fulfill({ json: { commands: [], targets: [] } }));
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ json: { user: { id: 'u1' }, platformRole: 'none', capability: 'creator' } }),
  );
  await page.route('**/api/v1/me/executor/thread', (route) => route.fulfill({ status: 403, json: {} }));
  await page.route('**/api/v1/energy', (route) =>
    route.fulfill({ json: { level: 'limited', preference: 'balanced', windows: [], services: [] } }),
  );
  await page.route('**/api/v1/games/game/branches', (route) => route.fulfill({ json: { branches: [] } }));
  await page.route('**/api/v1/games', (route) => route.fulfill({ json: { games: [] } }));
  await page.route('**/api/v1/budget/status', (route) => route.fulfill({ json: { unitLabel: 'coins' } }));
  await page.goto('/g/game?mode=edit&test', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.edit-workspace')).toBeVisible();
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
}

/* Mic, two-way voice and attach show only when this browser's voice and upload probes pass; colour doesn't depend on that. */
async function revealAllButtons(composer: Locator): Promise<void> {
  await composer.evaluate((element) => {
    for (const button of element.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[part]')) button.hidden = false;
    element.setAttribute('data-recording', '');
  });
}

/* One screenshot per state, cropped per button: a screenshot per button times out on a loaded runner. */
async function measure(composer: Locator, shot: Buffer, parts: string[], state = ''): Promise<string[]> {
  const boxes = await composer.evaluate((element, names) => {
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const root = element.shadowRoot!;
    return {
      card: box(root.querySelector('.card')!),
      buttons: names.map((name) => {
        const button = root.querySelector<HTMLButtonElement>(`button[part="${name}"]`)!;
        return { name, disabled: button.disabled, ...box(button) };
      }),
    };
  }, parts);
  const image = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const card = mode(pixelsIn(image, boxes.card, 1));
  return boxes.buttons.flatMap((button) => {
    const disc = pixelsIn(image, button, 0.9);
    const face = mode(disc);
    const icon = disc.reduce((best, pixel) => (contrast(pixel, face) > contrast(best, face) ? pixel : best), face);
    const label = `${button.name}${state || (button.disabled ? ' (disabled)' : '')}`;
    return [line(`${label} icon on button`, icon, face), line(`${label} button on card`, face, card)];
  });
}

function line(name: string, a: Rgb, b: Rgb): string {
  const ratio = contrast(a, b);
  return `${ratio >= AA_NON_TEXT ? 'ok' : 'FAIL'} ${name}: ${ratio.toFixed(2)} (${hex(a)} on ${hex(b)})`;
}

type Box = { x: number; y: number; width: number; height: number };
type Raw = { data: Buffer; info: { width: number; height: number } };

/* Pixels of a box in the screenshot; with discScale < 1, only those inside the button's inscribed circle. */
function pixelsIn({ data, info }: Raw, box: Box, discScale: number): Rgb[] {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const radius = (Math.min(box.width, box.height) / 2) * discScale;
  const pixels: Rgb[] = [];
  for (let y = Math.floor(box.y); y < Math.min(info.height, Math.ceil(box.y + box.height)); y++) {
    for (let x = Math.floor(box.x); x < Math.min(info.width, Math.ceil(box.x + box.width)); x++) {
      if (discScale < 1 && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > radius ** 2) continue;
      const i = (y * info.width + x) * 3;
      pixels.push([data[i]!, data[i + 1]!, data[i + 2]!]);
    }
  }
  return pixels;
}

function mode(pixels: Rgb[]): Rgb {
  const counts = new Map<string, { pixel: Rgb; count: number }>();
  for (const pixel of pixels) {
    const key = pixel.join();
    const entry = counts.get(key) ?? { pixel, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]!.pixel;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function hex(pixel: Rgb): string {
  return `#${pixel.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
