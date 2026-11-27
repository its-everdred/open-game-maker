import { afterEach, describe, expect, it, vi } from 'vitest';

import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';

import { ALLOW_LIST_SEEDED_KEY, listAllowedUsers, seedAllowList, setAllowedRole } from '../src/auth/allow-list.js';
import { authContextFor } from '../src/auth/routes.js';
import { NullRepoProvisioner } from '../src/games/repo-provisioner.js';
import { signIn } from './auth-helpers.js';
import { INTERNAL_TOKEN, makeApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

type Made = Awaited<ReturnType<typeof makeApp>>;

const outbox = (deps: Made['deps']) => () =>
  deps.sqlite.prepare('SELECT "to", text FROM mail_outbox ORDER BY created_at').all() as {
    to: string;
    text: string;
  }[];

const body = (value: unknown, init: RequestInit = {}): RequestInit => ({
  method: 'POST',
  ...init,
  headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  body: JSON.stringify(value),
});

async function adminSession(made: Made, email = 'kevin@example.com') {
  const { session } = await signIn(made.app, outbox(made.deps), email);
  setAllowedRole(made.deps.db, email, 'admin');
  const owner = made.deps.db.select().from(schema.user).where(eq(schema.user.email, email)).get()!;
  const now = new Date().toISOString();
  made.deps.db
    .insert(schema.families)
    .values({ id: 'family-admin', name: 'Admin family', ownerUserId: owner.id, createdAt: now })
    .run();
  made.deps.db
    .insert(schema.familyMembers)
    .values({ familyId: 'family-admin', userId: owner.id, role: 'owner', capability: 'creator', joinedAt: now })
    .run();
  return session;
}

describe('the seed of the allow list', () => {
  it('writes the env lists once: maintainers become admins, the rest keep creation as makers', async () => {
    const made = await makeApp();

    expect(listAllowedUsers(made.deps.db).map((row) => [row.email, row.role, row.addedBy])).toEqual([
      ['kevin@example.com', 'maker', 'env'],
      ['kim@example.com', 'maker', 'env'],
      ['sam@example.com', 'maker', 'env'],
    ]);
  });

  it('leaves rows an admin later changed alone when the env still lists the address', async () => {
    const made = await makeApp();
    setAllowedRole(made.deps.db, 'kim@example.com', 'admin');

    vi.stubEnv('OGM_ALLOWED_EMAILS', 'kim@example.com, later@example.com');
    vi.stubEnv('OGM_MAINTAINER_EMAILS', 'kevin@example.com');
    const restarted = await makeApp();

    expect(seedAllowList(restarted.deps.db, { allowed: new Set(['later@example.com']), maintainers: new Set() })).toBe(
      0,
    );
    expect(restarted.deps.db.select().from(schema.appMeta).all()).toContainEqual({
      key: ALLOW_LIST_SEEDED_KEY,
      value: expect.any(String),
    });
    expect(listAllowedUsers(made.deps.db).map((row) => [row.email, row.role])).toEqual([
      ['kevin@example.com', 'maker'],
      ['kim@example.com', 'admin'],
      ['sam@example.com', 'maker'],
    ]);
  });

  it('admits nobody and warns when both env lists are empty', async () => {
    vi.stubEnv('OGM_ALLOWED_EMAILS', '');
    vi.stubEnv('OGM_MAINTAINER_EMAILS', '');
    const made = await makeApp();

    expect(listAllowedUsers(made.deps.db)).toEqual([]);
    expect(made.deps.lines).toContainEqual({ event: 'auth-allow-list-empty', level: 'warn' });
  });
});

describe('/api/v1/admin/users', () => {
  it('keeps a player out of user management', async () => {
    const made = await makeApp();
    const player = await signIn(made.app, outbox(made.deps), 'kim@example.com');

    const listed = await made.app.request('/api/v1/admin/users', { headers: { cookie: player.session } });
    const added = await made.app.request('/api/v1/admin/users', {
      ...body({ email: 'new@example.com', role: 'player' }),
      headers: { cookie: player.session },
    });

    expect(listed.status).toBe(403);
    expect(added.status).toBe(403);
    expect(listAllowedUsers(made.deps.db)).toHaveLength(3);
  });

  it('lists every allowed address with its role, then adds, re-roles and removes one', async () => {
    const made = await makeApp();
    const admin = await adminSession(made);
    const headers = { cookie: admin };

    const listed = await made.app.request('/api/v1/admin/users', { headers });
    const rows = ((await listed.json()) as { users: { email: string; role: string; lastSignInAt: string | null }[] })
      .users;
    expect(listed.status).toBe(200);
    expect(rows.map((row) => [row.email, row.role])).toEqual([
      ['kevin@example.com', 'admin'],
      ['kim@example.com', 'maker'],
      ['sam@example.com', 'maker'],
    ]);
    expect(rows[0].lastSignInAt).toEqual(expect.any(String));

    const added = await made.app.request('/api/v1/admin/users', {
      ...body({ email: ' New@Testers.example ', role: 'player' }),
      headers,
    });
    expect(added.status).toBe(201);
    expect(((await added.json()) as { user: { email: string; role: string; addedBy: string } }).user).toMatchObject({
      email: 'new@testers.example',
      role: 'player',
      addedBy: expect.stringMatching(/^u_/),
    });

    const patched = await made.app.request('/api/v1/admin/users/new%40testers.example', {
      ...body({ role: 'maker' }, { method: 'PATCH' }),
      headers,
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { user: { role: string } }).user.role).toBe('maker');

    const duplicate = await made.app.request('/api/v1/admin/users', {
      ...body({ email: 'kim@example.com', role: 'admin' }),
      headers,
    });
    expect(duplicate.status).toBe(409);

    const removed = await made.app.request('/api/v1/admin/users/kim%40example.com', { method: 'DELETE', headers });
    expect(removed.status).toBe(204);
    expect(listAllowedUsers(made.deps.db).map((row) => row.email)).toEqual([
      'kevin@example.com',
      'sam@example.com',
      'new@testers.example',
    ]);
  });

  it('mails an added address its sign-in link and mails it again on resend', async () => {
    const made = await makeApp();
    const admin = await adminSession(made);
    const headers = { cookie: admin };

    await made.app.request('/api/v1/admin/users', {
      ...body({ email: 'tester@example.com', role: 'player' }),
      headers,
    });
    const first = outbox(made.deps)().filter((mail) => mail.to === 'tester@example.com');
    expect(first).toHaveLength(1);
    expect(first[0].text).toMatch(/\/auth\/magic-link\/verify\?token=/);

    const resent = await made.app.request('/api/v1/admin/users/tester%40example.com/invite', {
      ...body({}),
      headers,
    });
    const unlisted = await made.app.request('/api/v1/admin/users/stranger%40example.com/invite', {
      ...body({}),
      headers,
    });

    expect(resent.status).toBe(200);
    expect(outbox(made.deps)().filter((mail) => mail.to === 'tester@example.com')).toHaveLength(2);
    expect(unlisted.status).toBe(404);
  });

  it('sends a family-bound first-run link to a newly invited maker', async () => {
    const made = await makeApp();
    const admin = await adminSession(made);
    const response = await made.app.request('/api/v1/admin/users', {
      ...body({ email: 'new-maker@example.com', role: 'maker' }),
      headers: { cookie: admin, 'x-ogm-qa-run': '12345678-1234-1234-1234-123456789abc' },
    });
    expect(response.status).toBe(201);
    expect(listAllowedUsers(made.deps.db).find((row) => row.email === 'new-maker@example.com')?.addedBy).toMatch(
      /:qa:12345678-1234-1234-1234-123456789abc$/,
    );
    const mail = outbox(made.deps)().find((entry) => entry.to === 'new-maker@example.com')!;
    const url = new URL(/https:\/\/\S+/.exec(mail.text)![0]);
    const callback = new URL(url.searchParams.get('callbackURL')!);
    expect(callback.pathname).toBe('/welcome');
    const token = callback.searchParams.get('invite');
    expect(token).toBeTruthy();
    const verified = await made.app.request(url.pathname + url.search);
    const cookie = verified.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    const accepted = await made.app.request(`/api/v1/invites/${token}/accept`, { method: 'POST', headers: { cookie } });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ kind: 'member', familyId: 'family-admin', capability: 'creator' });
  });

  it('preserves instance-wide invitations for an admin without a family', async () => {
    const made = await makeApp();
    const admin = await adminSession(made);
    made.deps.db.delete(schema.familyMembers).where(eq(schema.familyMembers.familyId, 'family-admin')).run();
    const response = await made.app.request('/api/v1/admin/users', {
      ...body({ email: 'no-family@example.com', role: 'maker' }),
      headers: { cookie: admin },
    });
    expect(response.status).toBe(201);
    const mail = outbox(made.deps)().find((entry) => entry.to === 'no-family@example.com')!;
    const link = new URL(/https:\/\/\S+/.exec(mail.text)![0]);
    expect(new URL(link.searchParams.get('callbackURL')!).pathname).toBe('/games');
  });

  it('revokes an outstanding family invite when an address is removed', async () => {
    const made = await makeApp();
    const admin = await adminSession(made);
    const headers = { cookie: admin };
    await made.app.request('/api/v1/admin/users', { ...body({ email: 'retry@example.com', role: 'maker' }), headers });
    const first = outbox(made.deps)().find((mail) => mail.to === 'retry@example.com')!;
    const link = new URL(/https:\/\/\S+/.exec(first.text)![0]);
    const token = new URL(link.searchParams.get('callbackURL')!).searchParams.get('invite');
    expect(
      (await made.app.request('/api/v1/admin/users/retry%40example.com', { method: 'DELETE', headers })).status,
    ).toBe(204);
    await made.app.request('/api/v1/admin/users', { ...body({ email: 'retry@example.com', role: 'maker' }), headers });
    const verified = await made.app.request(link.pathname + link.search);
    const cookie = verified.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    expect(
      (await made.app.request(`/api/v1/invites/${token}/accept`, { method: 'POST', headers: { cookie } })).status,
    ).toBe(410);
  });

  it('removes a newly minted invitation when the sign-in request fails', async () => {
    const made = await makeApp();
    const admin = await adminSession(made);
    const auth = authContextFor(made.deps)!.auth;
    const handler = vi.spyOn(auth, 'handler').mockResolvedValueOnce(new Response('', { status: 429 }));
    const result = await made.app.request('/api/v1/admin/users', {
      ...body({ email: 'failure@example.com', role: 'maker' }),
      headers: { cookie: admin },
    });
    expect(result.status).toBe(502);
    expect(made.deps.db.select().from(schema.invitations).all()).toHaveLength(0);
    expect(listAllowedUsers(made.deps.db).some((row) => row.email === 'failure@example.com')).toBe(false);
    handler.mockRestore();
  });

  it('ends the removed user’s session and refuses to remove the caller', async () => {
    const made = await makeApp();
    const admin = await adminSession(made);
    const headers = { cookie: admin };
    const player = await signIn(made.app, outbox(made.deps), 'kim@example.com');

    // `/api/v1/me` answers only for a live session, so it stands in for "is this cookie still good".
    expect((await made.app.request('/api/v1/me', { headers: { cookie: player.session } })).status).toBe(200);

    const removed = await made.app.request('/api/v1/admin/users/kim%40example.com', { method: 'DELETE', headers });
    const after = await made.app.request('/api/v1/me', { headers: { cookie: player.session } });
    const sessions = made.deps.sqlite
      .prepare('SELECT count(*) FROM session JOIN user ON user.id = session.user_id WHERE user.email = ?')
      .pluck()
      .get('kim@example.com');
    const self = await made.app.request('/api/v1/admin/users/kevin%40example.com', { method: 'DELETE', headers });

    expect(removed.status).toBe(204);
    expect(after.status).toBe(401);
    expect(sessions).toBe(0);
    expect(self.status).toBe(409);
  });
});

describe('roles at the API boundary', () => {
  it('refuses game creation from a player and admits a maker', async () => {
    const made = await makeApp();
    const provisioner = new NullRepoProvisioner();
    made.deps.registry.repoProvisioner = provisioner;
    setAllowedRole(made.deps.db, 'kim@example.com', 'player');
    const player = await signIn(made.app, outbox(made.deps), 'kim@example.com');
    const maker = await signIn(made.app, outbox(made.deps), 'sam@example.com');
    const makerId = made.deps.db.select().from(schema.user).where(eq(schema.user.email, 'sam@example.com')).get()!.id;
    const joinedAt = new Date().toISOString();
    made.deps.db
      .insert(schema.families)
      .values({ id: 'family-maker', name: 'Maker household', ownerUserId: makerId, createdAt: joinedAt })
      .run();
    made.deps.db
      .insert(schema.familyMembers)
      .values([{ familyId: 'family-maker', userId: makerId, role: 'owner', capability: 'creator', joinedAt }])
      .run();
    const create = { ...body({ title: 'Puzzle', repoVisibility: 'private' }) };

    const fromPlayer = await made.app.request('/api/v1/games', { ...create, headers: { cookie: player.session } });
    const fromMaker = await made.app.request('/api/v1/games', { ...create, headers: { cookie: maker.session } });

    expect(fromPlayer.status).toBe(403);
    // Role authorization admits the maker; the game lands as a folder in the instance repository.
    expect(fromMaker.status).toBe(201);
    expect(provisioner.calls).toEqual([
      { id: expect.stringMatching(/^g_/), title: 'Puzzle', slug: 'puzzle', visibility: 'private' },
    ]);
  });
});

describe('weekly user budgets', () => {
  it('lets an admin set limits before first sign-in and refuses a player', async () => {
    const made = await makeApp();
    const admin = await adminSession(made);
    const player = await signIn(made.app, outbox(made.deps), 'kim@example.com');
    const url = '/api/v1/admin/users/sam%40example.com/weekly-budget';
    const update = { newGames: 0, edits: null };
    const denied = await made.app.request(url, {
      ...body(update, { method: 'PUT' }),
      headers: { cookie: player.session },
    });
    expect(denied.status).toBe(403);
    const saved = await made.app.request(url, { ...body(update, { method: 'PUT' }), headers: { cookie: admin } });
    expect(saved.status).toBe(200);
    const listed = await made.app.request('/api/v1/admin/users', { headers: { cookie: admin } });
    const result = (await listed.json()) as { users: { email: string; weeklyBudget: typeof update }[] };
    expect(result.users.find((user) => user.email === 'sam@example.com')?.weeklyBudget).toEqual(update);
  });
});

it('prevents changing or removing the QA user while its probe is active', async () => {
  const made = await makeApp();
  const admin = await adminSession(made);
  const internal = { 'x-ogm-internal': INTERNAL_TOKEN, 'content-type': 'application/json' };
  const session = await made.app.request('/internal/qa/session', {
    method: 'POST',
    headers: internal,
    body: JSON.stringify({ email: 'qa@example.test' }),
  });
  expect(session.status).toBe(200);
  const begun = await made.app.request('/internal/qa/energy-budget/begin', { method: 'POST', headers: internal });
  const { id } = (await begun.json()) as { id: string };
  const budget = await made.app.request('/api/v1/admin/users/qa%40example.test/weekly-budget', {
    ...body({ newGames: 1, edits: 1 }, { method: 'PUT' }),
    headers: { cookie: admin, 'content-type': 'application/json' },
  });
  const remove = await made.app.request('/api/v1/admin/users/qa%40example.test', {
    method: 'DELETE',
    headers: { cookie: admin },
  });
  expect([budget.status, remove.status]).toEqual([409, 409]);
  expect(
    (
      await made.app.request('/internal/qa/energy-budget/end', {
        method: 'POST',
        headers: internal,
        body: JSON.stringify({ id }),
      })
    ).status,
  ).toBe(204);
}, 120_000);
