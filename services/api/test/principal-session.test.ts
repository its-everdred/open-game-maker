import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyWsToken } from '../src/app/app.js';
import type { Auth } from '../src/auth/auth.js';
import { sessionResolver } from '../src/auth/principal.js';
import { NullRepoProvisioner } from '../src/games/repo-provisioner.js';
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
  it('applies allow-list promotion and demotion to the same session on the next request', async () => {
    const { app, deps, outbox } = await setup();
    const { session } = await signIn(app, outbox, 'kim@example.com');
    deps.sqlite.prepare('UPDATE allowed_users SET role = ? WHERE email = ?').run('admin', 'sam@example.com');
    const { session: adminSession } = await signIn(app, outbox, 'sam@example.com');
    for (const [role, capability] of [
      ['player', 'player'],
      ['maker', 'creator'],
      ['player', 'player'],
    ] as const) {
      const response = await app.request('/api/v1/admin/users/kim%40example.com', {
        method: 'PATCH',
        headers: { cookie: adminSession, 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      expect(response.status).toBe(200);
      expect(await whoami(app, { cookie: session })).toMatchObject({ capability });
      const me = await app.request('/api/v1/me', { headers: { cookie: session } });
      expect(me.headers.get('x-ogm-capability')).toBe(capability);
    }
  });

  it('allows a promoted familyless account to create and edit, then denies edits after demotion', async () => {
    const { app, deps, outbox } = await setup();
    deps.registry.repoProvisioner = new NullRepoProvisioner();
    const startDraft = vi.fn().mockResolvedValue({ repo: 'instance/games', ticket: '42' });
    deps.registry.draftScopeAssistant = { create: startDraft, close: vi.fn(), transcript: vi.fn() };
    const { session } = await signIn(app, outbox, 'kim@example.com');
    deps.sqlite.prepare('UPDATE allowed_users SET role = ? WHERE email = ?').run('admin', 'sam@example.com');
    const { session: adminSession } = await signIn(app, outbox, 'sam@example.com');
    const setRole = (role: string) =>
      app.request('/api/v1/admin/users/kim%40example.com', {
        method: 'PATCH',
        headers: { cookie: adminSession, 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
    const create = () =>
      app.request('/api/v1/games', {
        method: 'POST',
        headers: { cookie: session, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'My game', repoVisibility: 'private' }),
      });
    const draft = () =>
      app.request('/api/v1/game-drafts', {
        method: 'POST',
        headers: { cookie: session, 'content-type': 'application/json' },
        body: JSON.stringify({
          choices: {
            genre: 'platformer',
            vibe: 'cozy',
            family: 'chunky-low-poly',
            world: 'floating islands',
            players: 'single',
            pov: 'isometric',
          },
        }),
      });
    expect((await setRole('player')).status).toBe(200);
    expect((await draft()).status).toBe(403);
    expect(startDraft).not.toHaveBeenCalled();
    expect((await create()).status).toBe(403);
    expect((await setRole('maker')).status).toBe(200);
    expect((await draft()).status).toBe(201);
    const created = await create();
    expect(created.status).toBe(201);
    const game = (await created.json()) as { id: string };
    const edit = () =>
      app.request(`/api/v1/games/${game.id}`, {
        method: 'PATCH',
        headers: { cookie: session, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Updated game' }),
      });
    expect((await edit()).status).toBe(200);
    expect((await setRole('player')).status).toBe(200);
    expect((await edit()).status).toBe(403);
  });
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
    const { app, deps, outbox } = await setup();
    const { session } = await signIn(app, outbox, 'kevin@example.com');
    expect(await whoami(app, { cookie: session })).toMatchObject({ platformRole: 'maintainer' });
    deps.sqlite.prepare('UPDATE allowed_users SET role = ? WHERE email = ?').run('player', 'kevin@example.com');
    expect(await whoami(app, { cookie: session })).toMatchObject({ platformRole: 'maintainer', capability: 'creator' });
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
    // The family row supplies the games this session can see; the allow-list role decides what it may do.
    expect(await whoami(app, { cookie: session })).toMatchObject({
      familyId: 'f_1',
      platformRole: 'none',
      capability: 'creator',
    });
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
