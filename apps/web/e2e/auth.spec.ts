import { expect, test, type Page } from '@playwright/test';

import { GOOGLE_CHOOSER, installAuthRoutes } from './fixtures/auth-routes';

test.use({ serviceWorkers: 'block' });

test('Start goes straight to the magic-link sent state', async ({ page }) => {
  await installAuthRoutes(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/\/signin\?next=%2Fall$/);
  const sendButton = page.getByRole('button', { name: 'Send sign-in link' });
  expect((await sendButton.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await page.getByLabel('Email').fill('kim@example.com');
  await sendButton.click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
});

test('Start leads to Google when it is configured', async ({ page }) => {
  await installAuthRoutes(page, { google: true });
  await page.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Google</title>' }),
  );
  await page.goto('/');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/\/signin\?next=%2Fall$/);
  const google = page.getByRole('button', { name: 'Continue with Google' });
  expect((await google.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await google.click();
  await expect(page).toHaveURL(GOOGLE_CHOOSER);
});

test('a protected route sends a signed-out visitor to sign in and preserves next', async ({ page }) => {
  await installAuthRoutes(page);
  await page.goto('/all?test');

  await expect(page).toHaveURL(/\/signin\?next=%2Fall$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a signed-in creator lands on the games screen without a GitHub step', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true, github: 'octocat' });
  await page.goto('/');

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // Creators never connect GitHub: the instance operator installed the App on the instance repository once.
  await expect(page).toHaveURL(/\/all$/);
  await expect(page).not.toHaveURL(/\/connect\/github/);
});

test('the GitHub App setup callback still shows the installation to the operator', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true, github: 'octocat' });
  await page.goto('/connect/github');

  await expect(page.getByText('@octocat')).toBeVisible();
  await expect(page.getByRole('button', { name: /private/i })).toHaveAttribute('aria-pressed', 'true');
});

test('passkey registration makes one options and verify request per click', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Playwright baseURL is required for the passkey test.');
  const registration = { options: 0, verify: 0, rejectFirstVerify: true };
  await installAuthRoutes(page, { signedIn: true, passkeyRegistration: registration });
  await installVirtualAuthenticator(page);

  const signInUrl = new URL('/signin?next=%2Fall&magic=1', baseURL);
  signInUrl.hostname = 'localhost';
  await page.goto(signInUrl.href);
  await expect(page.getByRole('button', { name: 'Add a passkey' })).toBeVisible();
  expect(registration).toMatchObject({ options: 0, verify: 0 });
  await page.getByRole('button', { name: 'Add a passkey' }).click({ force: true });
  await expect(page.getByRole('alert')).toContainText('You can still sign in with an email link.');
  expect(registration).toMatchObject({ options: 1, verify: 1 });

  await page.getByRole('button', { name: 'Add a passkey' }).click({ force: true });
  await expect(page).toHaveURL(/\/all$/);
  expect(registration).toMatchObject({ options: 2, verify: 2 });
});

test('leaving passkey enrollment aborts an in-flight verification request', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Playwright baseURL is required for the passkey test.');
  let releaseVerification!: () => void;
  const verifyGate = new Promise<void>((resolve) => (releaseVerification = resolve));
  const registration = { options: 0, verify: 0, verifyGate };
  await installAuthRoutes(page, { signedIn: true, passkeyRegistration: registration });
  await installVirtualAuthenticator(page);

  const signInUrl = new URL('/signin?next=%2Fall&magic=1', baseURL);
  signInUrl.hostname = 'localhost';
  await page.goto(signInUrl.href);
  const failedVerification = page.waitForEvent('requestfailed', {
    predicate: (request) => new URL(request.url()).pathname === '/auth/passkey/verify-registration',
    timeout: 5_000,
  });
  await page.getByRole('button', { name: 'Add a passkey' }).click({ force: true });
  await expect.poll(() => registration.verify).toBe(1);

  await page.evaluate(() => {
    history.pushState(null, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
  });

  const request = await failedVerification;
  expect(request.failure()?.errorText).toContain('ERR_ABORTED');
  await expect(page).toHaveURL(/\/$/);
  releaseVerification();
  await expect(page).not.toHaveURL(/\/all$/);
});

async function installVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}
