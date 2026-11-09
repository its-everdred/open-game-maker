import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_ORIGIN, SESSION_COOKIE, cookiePair } from './auth-helpers.js';
import { makeApp } from './helpers.js';

// Google is the main sign-in method. Its callback must only ever open a session for an address on
// the allow-list, and it must go through the app origin (the Netlify same-origin proxy) like every
// other auth path.

type App = Awaited<ReturnType<typeof makeApp>>['app'];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function configureGoogle() {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
}

// The redirect flow reads the profile from the id token in Google's token response; it is never
// verified there (the token came straight from Google over TLS), so an unsigned one stands in.
function fakeGoogleTokenEndpoint(email: string) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const idToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: 'https://accounts.google.com',
    aud: 'client-id.apps.googleusercontent.com',
    sub: `google-${email}`,
    email,
    email_verified: true,
    name: 'Kim',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.`;
  const realFetch = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'access', id_token: idToken, token_type: 'Bearer', expires_in: 3600 });
    }
    return realFetch(input, init);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function startGoogle(app: App) {
  const response = await app.request('/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
    body: JSON.stringify({ provider: 'google', callbackURL: '/all', errorCallbackURL: '/signin' }),
  });
  expect(response.status).toBe(200);
  const url = new URL(((await response.json()) as { url: string }).url);
  const cookies = response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
  return { url, cookies };
}

async function finishGoogle(app: App, email: string) {
  const { url, cookies } = await startGoogle(app);
  const tokenEndpoint = fakeGoogleTokenEndpoint(email);
  const callback = await app.request(`/auth/callback/google?code=google-code&state=${url.searchParams.get('state')}`, {
    headers: { cookie: cookies },
  });
  return { callback, tokenEndpoint };
}

describe('Google sign-in', () => {
  it('starts without an age cookie and returns through the app origin', async () => {
    configureGoogle();
    const { app } = await makeApp();
    const { url, cookies } = await startGoogle(app);

    expect(cookies).not.toMatch(/age/i);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/auth/callback/google`);
  });

  it('opens a session for an allow-listed Google address', async () => {
    configureGoogle();
    const { app, deps } = await makeApp();
    const { callback, tokenEndpoint } = await finishGoogle(app, 'kim@example.com');

    expect(tokenEndpoint).toHaveBeenCalled();
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get('location')!, APP_ORIGIN).pathname).toBe('/all');
    expect(cookiePair(callback, SESSION_COOKIE)).toBeDefined();
    expect(deps.sqlite.prepare('SELECT email FROM user').all()).toEqual([{ email: 'kim@example.com' }]);
    expect(deps.sqlite.prepare("SELECT provider_id FROM account WHERE provider_id = 'google'").all()).toHaveLength(1);
  });

  it('refuses a Google address that is not on the allow-list', async () => {
    configureGoogle();
    const { app, deps } = await makeApp();
    const { callback } = await finishGoogle(app, 'stranger@example.com');

    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get('location')!, APP_ORIGIN);
    expect(location.pathname).toBe('/signin');
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(cookiePair(callback, SESSION_COOKIE)).toBeUndefined();
    expect(deps.sqlite.prepare('SELECT count(*) FROM user').pluck().get()).toBe(0);
    expect(deps.sqlite.prepare('SELECT count(*) FROM session').pluck().get()).toBe(0);
  });
});
