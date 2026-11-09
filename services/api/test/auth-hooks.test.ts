import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_ORIGIN, followLink, requestMagicLink, SESSION_COOKIE, cookiePair, signIn } from './auth-helpers.js';
import { createAuth, createAuthLogger } from '../src/auth/auth.js';
import { loadAuthEnv } from '../src/auth/env.js';
import { makeApp, makeDeps } from './helpers.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

type Deps = Awaited<ReturnType<typeof makeApp>>['deps'];
const outbox = (deps: Deps) => () =>
  deps.sqlite.prepare('SELECT * FROM mail_outbox ORDER BY created_at').all() as { to: string; text: string }[];
const users = (deps: Deps) =>
  deps.sqlite.prepare('SELECT email, age_band, age_attested_at FROM user').all() as {
    email: string;
    age_band: string | null;
    age_attested_at: string | null;
  }[];

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

function mutableAllowListAuth() {
  const deps = makeDeps();
  const env = loadAuthEnv();
  const allowedEmails = new Set(['kim@example.com']);
  const mails: { text: string }[] = [];
  const auth = createAuth({
    db: deps.db,
    env,
    isAllowed: (email) => allowedEmails.has(email),
    log: deps.log,
    mail: {
      send: async ({ text }) => {
        mails.push({ text });
        return { id: `mail-${mails.length}` };
      },
    },
  });
  return { allowedEmails, auth, deps, mails };
}

async function directMagicLink(auth: ReturnType<typeof mutableAllowListAuth>['auth']) {
  return auth.handler(post('/auth/sign-in/magic-link', { email: 'kim@example.com' }));
}

function mailLink(text: string): URL {
  const match = /https:\/\/\S+/.exec(text);
  if (!match) throw new Error('no link in mail text');
  return new URL(match[0]);
}

describe('allow-list enforcement on Better Auth', () => {
  it('sends a magic link without an age cookie', async () => {
    const { app, deps } = await makeApp();
    const response = await requestMagicLink(app, 'kim@example.com');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: true,
      message: 'If this address can sign in, a link is on its way',
    });
    expect(outbox(deps)()).toHaveLength(1);
  });

  it('enqueues one admin-inbox mail whose link creates a user', async () => {
    const { app, deps } = await makeApp();
    expect((await requestMagicLink(app, 'kim@example.com')).status).toBe(200);
    const mails = outbox(deps)();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('kim@example.com');
    expect(mails[0].text).toMatch(/https:\/\/makeopen\.games\/auth\/magic-link\/verify\?token=\S+/);

    const verified = await followLink(app, mails[0].text);
    expect(cookiePair(verified, SESSION_COOKIE)).toBeDefined();
    expect(users(deps)).toEqual([{ email: 'kim@example.com', age_band: null, age_attested_at: null }]);
  });

  it('keeps the retired age endpoint as a side-effect-free compatibility no-op', async () => {
    const { app, deps } = await makeApp();
    const response = await app.request('/auth/age', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ birthMonth: 5, birthYear: 2000 }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(users(deps)).toEqual([]);
  });

  it('gives listed and unlisted addresses the same answer without storing or mailing for the unlisted address', async () => {
    vi.stubEnv('OGM_ALLOWED_EMAILS', ' KIM@Example.com, sam@example.com ');
    const { app, deps } = await makeApp();
    const listed = await requestMagicLink(app, 'kim@example.com');
    const unlisted = await requestMagicLink(app, 'stranger@example.com');
    const neutral = { status: true, message: 'If this address can sign in, a link is on its way' };

    expect(listed.status).toBe(200);
    expect(unlisted.status).toBe(200);
    expect(await listed.json()).toEqual(neutral);
    expect(await unlisted.json()).toEqual(neutral);
    expect(outbox(deps)().map(({ to }) => to)).toEqual(['kim@example.com']);
    expect(deps.sqlite.prepare('SELECT count(*) FROM verification').pluck().get()).toBe(1);
    expect(users(deps)).toEqual([]);
  });

  it('rechecks the allow-list in the shared user-creation hook before opening an issued link', async () => {
    const { allowedEmails, auth, deps, mails } = mutableAllowListAuth();
    expect((await directMagicLink(auth)).status).toBe(200);
    allowedEmails.clear();

    const response = await auth.handler(new Request(mailLink(mails[0].text)));

    expect(response.status).not.toBe(200);
    expect(deps.sqlite.prepare('SELECT count(*) FROM user').pluck().get()).toBe(0);
    expect(deps.sqlite.prepare('SELECT count(*) FROM session').pluck().get()).toBe(0);
  });

  it('refuses passkey registration when an existing user is removed from the allow-list', async () => {
    const { allowedEmails, auth, mails } = mutableAllowListAuth();
    await directMagicLink(auth);
    const signedIn = await auth.handler(new Request(mailLink(mails[0].text)));
    const session = cookiePair(signedIn, SESSION_COOKIE);
    expect(session).toBeDefined();
    allowedEmails.clear();

    const response = await auth.handler(
      new Request(`${APP_ORIGIN}/auth/passkey/generate-register-options`, {
        headers: { cookie: session, origin: APP_ORIGIN },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'SIGN_IN_NOT_ALLOWED' });
  });

  it('starts a passkey sign-in without a session, since signing in is how a session begins', async () => {
    const { app } = await makeApp();
    const response = await app.request('/auth/passkey/generate-authenticate-options');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rpId: 'makeopen.games' });
  });

  it('still refuses passkey registration without a session', async () => {
    const { app } = await makeApp();
    const response = await app.request('/auth/passkey/generate-register-options');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'SIGN_IN_NOT_ALLOWED' });
  });

  it('allows passkey registration with a session and no age cookie', async () => {
    const { app, deps } = await makeApp();
    const { session } = await signIn(app, outbox(deps), 'kim@example.com');
    const allowed = await app.request('/auth/passkey/generate-register-options', {
      headers: { cookie: session },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ rp: { id: 'makeopen.games' } });
  });

  it('rate-limits magic links to 10 an hour per email and per client address', async () => {
    const { app } = await makeApp();
    const from = (ip: string) => ({ 'x-forwarded-for': ip });
    for (let index = 0; index < 10; index += 1) {
      expect((await requestMagicLink(app, 'kim@example.com', from(`203.0.113.${index}`))).status).toBe(200);
    }
    expect((await requestMagicLink(app, 'KIM@example.com', from('203.0.113.99'))).status).toBe(429);
    for (let index = 0; index < 10; index += 1) {
      expect((await requestMagicLink(app, `p${index}@example.com`, from('198.51.100.1'))).status).toBe(200);
    }
    expect((await requestMagicLink(app, 'sam@example.com', from('198.51.100.1'))).status).toBe(429);
    expect((await requestMagicLink(app, 'sam@example.com', from('198.51.100.2'))).status).toBe(200);
  });

  it('keeps the neutral response and logs when the SMTP sender fails', async () => {
    vi.stubEnv('SMTP_URL', 'smtp://127.0.0.1:1');
    const { app, deps } = await makeApp();
    const response = await requestMagicLink(app, 'kim@example.com');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: true,
      message: 'If this address can sign in, a link is on its way',
    });
    expect(deps.sqlite.prepare('SELECT count(*) FROM verification').pluck().get()).toBe(0);
    expect(deps.lines).toContainEqual({ event: 'auth-magic-link-mail-failed', level: 'error' });
  });

  it('does not copy untrusted request values into Better Auth logs', () => {
    const marker = 'untrusted-origin-marker';
    const lines: Record<string, unknown>[] = [];
    createAuthLogger((line) => lines.push(line)).log('error', `Invalid origin: ${marker}`, { marker });
    expect(lines).toEqual([{ event: 'better-auth', level: 'error' }]);
  });
});

describe('sign-in methods', () => {
  it('seeds maintainers as admins when the explicit allow-list is empty', async () => {
    vi.stubEnv('OGM_ALLOWED_EMAILS', ' , ');
    vi.stubEnv('OGM_MAINTAINER_EMAILS', ' Other@example.com, KIM@example.com ');
    const { app, deps } = await makeApp();
    const response = await requestMagicLink(app, 'kim@example.com');
    const denied = await requestMagicLink(app, 'stranger@example.com');

    expect(response.status).toBe(200);
    expect(await denied.json()).toEqual({
      status: true,
      message: 'If this address can sign in, a link is on its way',
    });
    expect(outbox(deps)()).toHaveLength(1);
    expect(deps.sqlite.prepare('SELECT email, role FROM allowed_users ORDER BY email').all()).toEqual([
      { email: 'kim@example.com', role: 'admin' },
      { email: 'other@example.com', role: 'admin' },
    ]);
    expect(deps.lines.filter(({ event }) => event === 'auth-allow-list-empty')).toEqual([]);
  });

  it('lists only the social providers configured at boot', async () => {
    const withoutGoogle = await makeApp();
    expect(await (await withoutGoogle.app.request('/auth/providers')).json()).toEqual({
      providers: ['magic-link', 'passkey'],
    });

    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
    const withGoogle = await makeApp();
    expect(await (await withGoogle.app.request('/auth/providers')).json()).toEqual({
      providers: ['magic-link', 'passkey', 'google'],
    });
  });

  it('has no password sign-up', async () => {
    const { app } = await makeApp();
    const body = { email: 'kim@example.com', password: 'correct horse battery', name: 'Kim' };
    expect((await app.request(post('/auth/sign-up/email', body))).status).toBe(400);
  });

  it('leaves Google out when its client id is unset', async () => {
    const { app } = await makeApp();
    const response = await app.request(post('/auth/sign-in/social', { provider: 'google' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
  });

  it('starts Google with the app-origin callback when the client is configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
    const { app } = await makeApp();
    const response = await app.request(post('/auth/sign-in/social', { provider: 'google' }));
    expect(response.status).toBe(200);
    const url = new URL(((await response.json()) as { url: string }).url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://makeopen.games/auth/callback/google');
  });

  it('treats blank optional names as unset at boot', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('SMTP_URL', '');
    const { deps } = await makeApp();
    expect(deps.lines).toContainEqual(
      expect.objectContaining({ event: 'auth-ready', mailSender: 'admin-inbox', google: false }),
    );
  });

  it('ignores the retired age-cookie secret in old env files', () => {
    const env = loadAuthEnv({
      OGM_APP_ORIGIN: APP_ORIGIN,
      OGM_SESSION_SECRET: 'session-secret-for-tests-0123456789abcdef',
      OGM_WS_TOKEN_SECRET: 'ws-token-secret-for-tests-0123456789',
      OGM_AGE_COOKIE_SECRET: 'legacy-age-cookie-secret',
    });

    expect(env).not.toHaveProperty('OGM_AGE_COOKIE_SECRET');
  });
});
