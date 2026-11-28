import { expect, test, type Page, type Route } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';
import { installGameApi } from './support/mock-game-api';

// #1223: on Kevin's iPhone every edit-page composer failure read "Message or voice could not be started." and never
// reached the API. Each forced failure must name its cause on screen and post it to the client-error report.

test('the edit page names a blocked microphone, a refused voice token and a failed admission at 390x844', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The viewport is set here; one browser covers it');
  test.slow(); /* one page walks three failures and three stills while the game frame renders */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  const reports = await openEditChat(page);
  const composer = page.locator('.edit-workspace-chat aiur-composer');
  const alert = page.locator('.edit-workspace-chat [role="alert"]');

  await composer.getByRole('button', { name: 'Dictate' }).click();
  await composer.getByRole('button', { name: 'Stop and send' }).click();
  await expect(alert).toHaveText(/^Microphone blocked\..*Safari.*\(dictation: mic_denied\)$/);
  await page.screenshot({ path: testInfo.outputPath('edit-mic-denied.png') });
  await expect
    .poll(() => reports)
    .toContainEqual(expect.objectContaining({ action: 'dictation', code: 'mic_denied', target_kind: 'edit' }));

  await composer.getByRole('button', { name: 'Dictate' }).click();
  await composer.getByRole('button', { name: 'Switch to voice conversation' }).click();
  await expect(alert).toHaveText('Voice unavailable. (voice: api_403)');
  await page.screenshot({ path: testInfo.outputPath('edit-token-403.png') });
  await expect
    .poll(() => reports)
    .toContainEqual(expect.objectContaining({ action: 'voice', code: 'api_403', target_kind: 'edit' }));

  await composer.locator('textarea').fill('Make the goblins faster');
  await composer.locator('textarea').press('Enter');
  await expect(alert).toHaveText('Message not sent. (send: api_500)');
  await page.screenshot({ path: testInfo.outputPath('edit-admission-500.png') });
  await expect.poll(() => reports).toContainEqual(expect.objectContaining({ action: 'send', code: 'api_500' }));
});

async function openEditChat(page: Page): Promise<unknown[]> {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css; charset=utf-8', body: '' }),
  );
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await installAuthRoutes(page, { signedIn: true });
  await installGameApi(page);
  // Registered after installGameApi, so these win over its catch-all.
  await page.route('**/api/v1/me/commands**', (route) => json(route, { commands: [], sessions: [] }));
  await page.route('**/api/v1/me/core-commands', (route) => json(route, { commands: [], targets: [] }));
  await page.route('**/api/v1/me', (route) => json(route, { platformRole: 'none' }));
  await page.route('**/api/v1/me/executor/thread', (route) => json(route, {}, 403));
  await page.route('**/api/v1/energy', (route) =>
    json(route, { level: 'limited', preference: 'balanced', windows: [], services: [] }),
  );
  await page.route('**/api/v1/games/game/branches', (route) => json(route, { branches: [] }));
  await page.route('**/api/v1/games', (route) => json(route, { games: [] }));
  await page.route('**/api/v1/budget/status', (route) => json(route, { unitLabel: 'coins' }));
  await page.route('**/api/v1/voice/token', (route) => json(route, { error: 'forbidden' }, 403));
  await page.route('**/api/v1/voice/dictation-token', (route) => json(route, { error: 'forbidden' }, 403));
  await page.route('**/api/v1/jobs', (route) =>
    route.request().method() === 'POST' ? json(route, { error: 'internal' }, 500) : route.fallback(),
  );
  const reports: unknown[] = [];
  await page.route('**/api/v1/voice/client-error', async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto('/g/game?mode=edit&test', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.edit-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Chat' }).click();
  await expect(page.locator('.edit-workspace-chat aiur-composer')).toBeVisible();
  return reports;
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
