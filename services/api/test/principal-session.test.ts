import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyWsToken } from '../src/app/app.js';
import type { Auth } from '../src/auth/auth.js';
import { sessionResolver } from '../src/auth/principal.js';
import { signIn, WS_SECRET } from './auth-helpers.js';
import { makeApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

async function setup() {
  const made = await makeApp();
  made.app.get('/api/v1/zz-test/whoami', (c) => c.json(c.get('principal')));
  const outbox = () =>
    made.deps.sqlite.prepare('SELECT text FROM mail_outbox ORDER BY created_at').all() as { text: string }[];
  const userId = (email: string) =>
    made.deps.sqlite.prepare('SELECT id FROM user WHERE email = ?').pluck().get(email) as string;
  return { ...made, outbox, userId };
}

const whoami = async (app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>) =>
  (await app.request('/api/v1/zz-test/whoami', { headers })).json();

describe('session principal resolver', () => {
  it('resolves the session cookie and the bearer session token to the same familyless maker', async () => {
    const { app, outbox, userId } = await setup();
    const { session, token } = await signIn(app, outbox, 'kim@example.com');
    // Seeded from `OGM_ALLOWED_EMAILS`, so this address is a maker with no family yet.
    const expected = {
      kind: 'user',
      userId: userId('kim@example.com'),
      displayName: 'Player',
      familyId: '',
      platformRole: 'none',
      capability: 'creator',
    };
    expect(expected.userId).toMatch(/^u_[0-9a-f-]{36}$/);
    expect(await whoami(app, { cookie: session })).toEqual(expected);
    expect(await whoami(app, { authorization: `Bearer ${token}` })).toEqual(expected);
  });

  it('stays anonymous for a forged session token', async () => {
    const { app } = await setup();
    expect(await whoami(app, { authorization: 'Bearer not-a-session-token' })).toEqual({ kind: 'anonymous' });
  });

  it('treats an existing session as anonymous after its email is removed from the allow-list', async () => {
    const { app, deps } = await setup();
    const auth: Auth = {
      handler: async () => new Response(null, { status: 404 }),
      api: {
        getSession: async () => ({
          user: { id: 'u_removed', name: 'Removed', email: 'removed@example.com' },
          session: { id: 's_removed' },
        }),
      },
    };
    deps.registry.principalResolvers.push(sessionResolver(auth, deps.sqlite, () => null));

    expect(await whoami(app, { 'x-removed-session': '1' })).toEqual({ kind: 'anonymous' });
  });

  it('names maintainers from OGM_MAINTAINER_EMAILS, case-insensitively', async () => {
    vi.stubEnv('OGM_MAINTAINER_EMAILS', 'other@example.com, Kevin@Example.com');
    const { app, outbox } = await setup();
    const { session } = await signIn(app, outbox, 'kevin@example.com');
    expect(await whoami(app, { cookie: session })).toMatchObject({ platformRole: 'maintainer' });
  });

  it('uses the stored display name and never exposes email as the room name', async () => {
    const { app, deps, outbox, userId } = await setup();
    const { session } = await signIn(app, outbox, 'kim@example.com');
    const id = userId('kim@example.com');

    deps.sqlite.prepare('UPDATE user SET name = ? WHERE id = ?').run('  Kim  ', id);
    expect(await whoami(app, { cookie: session })).toMatchObject({ displayName: 'Kim' });

    deps.sqlite.prepare('UPDATE user SET name = ? WHERE id = ?').run('kim@example.com', id);
    expect(await whoami(app, { cookie: session })).toMatchObject({ displayName: 'Player' });
  });

  it("reads the family from OGM-012's family_members and the role from the allow list", async () => {
    const { app, deps, outbox, userId } = await setup();
    const { session } = await signIn(app, outbox, 'sam@example.com');
    deps.sqlite
      .prepare(
        "INSERT INTO families (id, name, owner_user_id, friends_allowed, created_at) VALUES ('f_1', 'Sam', ?, 0, '2026-11-01')",
      )
      .run(userId('sam@example.com'));
    deps.sqlite
      .prepare(
        "INSERT INTO family_members (family_id, user_id, role, capability, joined_at) VALUES ('f_1', ?, 'admin', 'creator', '2026-11-01')",
      )
      .run(userId('sam@example.com'));
    // Both the allow list and current family membership constrain creator capability.
    expect(await whoami(app, { cookie: session })).toMatchObject({
      familyId: 'f_1',
      platformRole: 'none',
      capability: 'creator',
    });
    deps.sqlite
      .prepare("UPDATE family_members SET capability = 'player' WHERE user_id = ?")
      .run(userId('sam@example.com'));
    expect(await whoami(app, { cookie: session })).toMatchObject({ capability: 'player' });
  });

  it('registers auth-backed user-directory and mail providers for the accounts contexts', async () => {
    const { app, deps, outbox, userId } = await setup();
    await signIn(app, outbox, 'kim@example.com');
    const directory = deps.registry.userDirectory;
    const mail = deps.registry.mailSender;
    expect(directory).not.toBeNull();
    expect(mail).not.toBeNull();
    expect(await directory?.emailForUser(userId('kim@example.com'))).toBe('kim@example.com');
    expect(await directory?.userIdForEmail(' KIM@EXAMPLE.COM ')).toBe(userId('kim@example.com'));
    await mail?.send({ to: 'sam@example.com', subject: 'Invite', text: 'Join us' });
    expect(outbox().map(({ text }) => text)).toContain('Join us');
  });
});

describe('POST /auth/ws-token', () => {
  it('needs a user principal', async () => {
    const { app } = await setup();
    expect((await app.request('/auth/ws-token', { method: 'POST' })).status).toBe(401);
  });

  it('mints a five-minute ogw1 token for the signed-in user', async () => {
    const { app, outbox, userId } = await setup();
    const { token } = await signIn(app, outbox, 'kim@example.com');
    const response = await app.request('/auth/ws-token', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; expiresAt: string };
    const claims = verifyWsToken(body.token, WS_SECRET);
    expect(claims).toMatchObject({ sub: userId('kim@example.com'), familyId: '' });
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(290_000);
    expect(verifyWsToken(body.token, WS_SECRET, Date.now() + 301_000)).toBeNull();
  });
});
