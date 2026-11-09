import type { Page, Route } from '@playwright/test';

type PasskeyRegistrationTracker = {
  options: number;
  verify: number;
  rejectFirstVerify?: boolean;
  verifyGate?: Promise<void>;
};

type AuthFixture = {
  signedIn?: boolean;
  github?: string;
  google?: boolean;
  passkeyRegistration?: PasskeyRegistrationTracker;
};

export const GOOGLE_CHOOSER = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test';

export async function installAuthRoutes(page: Page, fixture: AuthFixture = {}) {
  await page.route('**/auth/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/auth/providers') {
      return json(route, {
        providers: fixture.google ? ['magic-link', 'passkey', 'google'] : ['magic-link', 'passkey'],
      });
    }
    if (path === '/auth/sign-in/social' && request.method() === 'POST' && fixture.google) {
      return json(route, { url: GOOGLE_CHOOSER, redirect: true });
    }
    if (path === '/auth/get-session') {
      return json(
        route,
        fixture.signedIn
          ? {
              user: { id: 'u1', name: 'Kim', email: 'kim@example.com' },
              session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
            }
          : null,
      );
    }
    if (path === '/auth/sign-in/magic-link' && request.method() === 'POST') return json(route, { status: true });
    if (path === '/auth/passkey/generate-register-options') {
      const tracker = fixture.passkeyRegistration;
      if (!tracker) return json(route, { code: 'NOT_MOCKED', path }, 404);
      tracker.options += 1;
      return json(route, registrationOptions(new URL(request.url()).hostname));
    }
    if (path === '/auth/passkey/verify-registration' && request.method() === 'POST') {
      const tracker = fixture.passkeyRegistration;
      if (!tracker) return json(route, { code: 'NOT_MOCKED', path }, 404);
      tracker.verify += 1;
      await tracker.verifyGate;
      if (request.failure()) return;
      if (tracker.rejectFirstVerify === true && tracker.verify === 1) {
        return json(route, { message: 'Password manager could not save the passkey.' }, 500);
      }
      return json(route, { id: 'pk1', credentialID: 'virtual-credential', userId: 'u1' });
    }
    if (path === '/auth/passkey/list-user-passkeys') return json(route, []);
    return json(route, { code: 'NOT_MOCKED', path }, 404);
  });
  await page.route('**/api/v1/github/connection', (route) =>
    json(route, fixture.github ? { connected: true, login: fixture.github } : { connected: false }),
  );
  await page.route('**/api/v1/me', (route) => json(route, { platformRole: 'none' }));
}

function registrationOptions(rpId: string) {
  return {
    challenge: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    rp: { id: rpId, name: 'Open Game Maker 2000' },
    user: { id: 'dTE', name: 'kim@example.com', displayName: 'Kim' },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout: 60_000,
    attestation: 'none',
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'preferred',
      requireResidentKey: false,
      userVerification: 'preferred',
    },
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
