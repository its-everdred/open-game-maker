import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { allowanceRemaining } from '../src/budget/allowance.js';
import { dayKey } from '../src/budget/reset.js';
import { seededApp, X, Y } from './admin-fixture.js';
import { asUser, type TestUser } from './helpers.js';

type Deps = Awaited<ReturnType<typeof seededApp>>['deps'];
const NOW = new Date().toISOString();

function job(deps: Deps, id: string, state: typeof schema.jobs.$inferInsert.state, slot: 'new_game' | 'edit') {
  deps.db
    .insert(schema.jobs)
    .values({
      id,
      gameId: X.game,
      branchId: 'main',
      familyId: X.family,
      creatorId: X.creator.userId,
      kind: slot === 'new_game' ? 'new_game' : 'feature',
      complexity: 1,
      state,
      start: 'now',
      slot,
      plan: '{}',
      reservation: '{}',
      hardCapMicroUsd: 500_000,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

describe('admin settings and budget', () => {
  it('merges a settings patch and shows the platform cap on settings and budget', async () => {
    const { call } = await seededApp();
    const patched = await call(X.admin, 'PATCH', '/settings', {
      platformCapMicroUsd: 20_000_000,
      slots: { new_game: 1, edit: 2 },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({
      familyId: X.family,
      resetZone: 'America/Los_Angeles',
      unitLabel: 'energy',
      microUsdPerUnit: 100_000,
      platformCapMicroUsd: 20_000_000,
      slots: { new_game: 1, edit: 2 },
      hardCapMultiplier: 1,
      friendsAllowed: false,
    });
    expect(await (await call(X.owner, 'GET', '/settings')).json()).toMatchObject({ platformCapMicroUsd: 20_000_000 });
    expect(await (await call(X.admin2, 'GET', '/budget')).json()).toMatchObject({ platformCapMicroUsd: 20_000_000 });
  });

  it('keeps an unset platform cap following the allowances when other settings change', async () => {
    const { call } = await seededApp();
    await call(X.admin, 'PATCH', '/settings', { unitLabel: 'stars', friendsAllowed: true });
    const before = (await (await call(X.admin, 'GET', '/settings')).json()) as { platformCapMicroUsd: number };
    await call(X.admin, 'PUT', `/allowances/${X.player.userId}`, { dailyMicroUsd: 50_000_000 });
    const after = (await (await call(X.admin, 'GET', '/settings')).json()) as {
      platformCapMicroUsd: number;
      unitLabel: string;
      friendsAllowed: boolean;
    };
    expect(after).toMatchObject({ unitLabel: 'stars', friendsAllowed: true });
    expect(after.platformCapMicroUsd).toBe(before.platformCapMicroUsd - 5_000_000 + 50_000_000);
  });

  it('keeps a pinned platform cap through later settings and allowance changes', async () => {
    const { call } = await seededApp();
    await call(X.admin, 'PATCH', '/settings', { platformCapMicroUsd: 20_000_000 });
    await call(X.admin, 'PATCH', '/settings', { unitLabel: 'stars' });
    await call(X.admin, 'PUT', `/allowances/${X.player.userId}`, { dailyMicroUsd: 50_000_000 });
    expect(await (await call(X.admin, 'GET', '/settings')).json()).toMatchObject({
      unitLabel: 'stars',
      platformCapMicroUsd: 20_000_000,
    });
  });

  it('rejects an unknown reset zone and accepts UTC', async () => {
    const { call } = await seededApp();
    expect((await call(X.admin, 'PATCH', '/settings', { resetZone: 'Mars/Olympus' })).status).toBe(400);
    expect((await call(X.admin, 'PATCH', '/settings', { resetZone: 'UTC' })).status).toBe(200);
    expect((await call(X.admin, 'PATCH', '/settings', { slots: { edit: 9 } })).status).toBe(400);
    expect((await call(X.admin, 'PATCH', '/settings', {})).status).toBe(400);
  });

  it('changes remaining when an allowance is set, as read back from the budget module', async () => {
    const { deps, call } = await seededApp();
    job(deps, 'j-spent', 'done', 'edit');
    deps.db
      .insert(schema.budgetLedger)
      .values({
        id: 'l-1',
        familyId: X.family,
        userId: X.creator.userId,
        jobId: 'j-spent',
        kind: 'usage',
        amountMicroUsd: 1_000_000,
        at: NOW,
        dayKey: dayKey(new Date(), 'America/Los_Angeles'),
      })
      .run();
    const defaults = { dailyAllowanceMicroUsd: 5_000_000, resetZone: 'America/Los_Angeles' };
    const read = () =>
      allowanceRemaining({ db: deps.db, familyId: X.family, userId: X.creator.userId, now: new Date(), defaults });
    expect(read().remainingMicroUsd).toBe(4_000_000);

    const put = await call(X.admin, 'PUT', `/allowances/${X.creator.userId}`, { dailyMicroUsd: 3_000_000 });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ dailyMicroUsd: 3_000_000, remainingMicroUsd: 2_000_000 });
    expect(read().remainingMicroUsd).toBe(2_000_000);
  });

  it('counts jobs in slot-holding states as in use and lists queued ones', async () => {
    const { deps, call } = await seededApp();
    job(deps, 'j-new', 'running', 'new_game');
    job(deps, 'j-edit-1', 'filed', 'edit');
    job(deps, 'j-edit-2', 'paused_budget', 'edit');
    job(deps, 'j-done', 'done', 'edit');
    job(deps, 'j-queued', 'queued', 'edit');
    const budget = (await (await call(X.admin, 'GET', '/budget')).json()) as Record<string, unknown>;
    expect(budget).toMatchObject({ inUse: { new_game: 1, edit: 2 }, queued: ['j-queued'] });
    expect(budget.members).toHaveLength(5);
  });
});

describe('admin members, games and mail', () => {
  it('lets only the owner demote a peer admin and never changes the owner', async () => {
    const { call } = await seededApp();
    expect((await call(X.admin, 'PATCH', `/members/${X.admin2.userId}`, { role: 'member' })).status).toBe(403);
    expect((await call(X.admin, 'PATCH', `/members/${X.owner.userId}`, { role: 'member' })).status).toBe(409);
    expect((await call(X.admin, 'DELETE', `/members/${X.owner.userId}`)).status).toBe(409);
    const demoted = await call(X.owner, 'PATCH', `/members/${X.admin2.userId}`, { role: 'member' });
    expect(await demoted.json()).toEqual({ userId: X.admin2.userId, role: 'member', capability: 'creator' });
    const promoted = await call(X.admin, 'PATCH', `/members/${X.player.userId}`, { role: 'admin' });
    expect(promoted.status).toBe(200);
    expect((await call(X.owner, 'PATCH', `/members/${X.owner.userId}`, { capability: 'player' })).status).toBe(409);
    const stepDown = await call(X.admin, 'PATCH', `/members/${X.admin.userId}`, { role: 'member' });
    expect(await stepDown.json()).toMatchObject({ role: 'member' });
  });

  it('keeps delist and relist admin-only, even for the game owner', async () => {
    const { call } = await seededApp();
    expect((await call(X.creator, 'POST', `/games/${X.game}/delist`)).status).toBe(403);
    expect((await call(X.admin, 'POST', `/games/${X.game}/delist`)).status).toBe(200);
    expect((await call(X.creator, 'POST', `/games/${X.game}/relist`)).status).toBe(403);
  });

  it('delists a member game from the picker without giving admins an edit path', async () => {
    const { app, call, deps } = await seededApp();
    deps.db.update(schema.games).set({ publishedReleaseId: 'rel-fixture' }).where(eq(schema.games.id, X.game)).run();
    expect((await call(X.admin, 'POST', `/games/${X.game}/delist`)).status).toBe(200);
    const picker = (await (await app.request('/api/v1/games', { headers: asUser(X.player.userId) })).json()) as {
      games: unknown[];
    };
    expect(picker.games).toEqual([]);
    expect((await app.request(`/api/v1/games/${X.game}`, { headers: asUser(X.creator.userId) })).status).toBe(200);
    expect(((await (await call(X.admin, 'GET', '/games')).json()) as { games: unknown[] }).games).toHaveLength(1);
    expect(
      ((await (await call(X.admin, 'GET', '/games?includeDelisted=1')).json()) as { games: unknown[] }).games,
    ).toHaveLength(2);
    const edit = await app.request(`/api/v1/games/${X.game}`, {
      method: 'PATCH',
      headers: { ...asUser(X.admin.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Taken over' }),
    });
    expect(edit.status).toBe(403);
    await call(X.admin, 'POST', `/games/${X.game}/relist`);
    expect(
      (
        (await (await app.request('/api/v1/games', { headers: asUser(X.player.userId) })).json()) as {
          games: unknown[];
        }
      ).games,
    ).toHaveLength(1);
  });

  it('lists the link an invite mailed until it is marked opened', async () => {
    const { app, call } = await seededApp();
    const invited = await app.request('/api/v1/invites', {
      method: 'POST',
      headers: { ...asUser(X.owner.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'member', email: 'Cousin@Example.com', capability: 'creator' }),
    });
    expect(invited.status).toBe(201);
    type Mail = { id: string; to: string; text: string };
    const unopened = async () =>
      ((await (await call(X.admin, 'GET', '/mail?unopened=1')).json()) as { mail: Mail[] }).mail;
    const link = (await unopened()).find((mail) => mail.to === 'cousin@example.com');
    expect(link?.text).toMatch(/\/join\//);
    expect((await call(X.admin, 'POST', `/mail/${link!.id}/opened`)).status).toBe(204);
    expect((await unopened()).map((mail) => mail.id)).not.toContain(link!.id);

    const invites = (await (await call(X.admin, 'GET', '/invites')).json()) as { invitations: { id: string }[] };
    expect(invites.invitations).toHaveLength(2);
    expect((await call(X.admin, 'DELETE', `/invites/${X.invite}`)).status).toBe(204);
  });

  it('never shows sign-in mail an admin may not read', async () => {
    const { deps, call } = await seededApp();
    const mail = (id: string, to: string) =>
      deps.db
        .insert(schema.mailOutbox)
        .values({ id, to, subject: 'Sign in', text: 'https://x/auth/magic', createdAt: NOW })
        .run();
    // Y's admin invites X's owner, then X's owner signs in: Y must not see that link.
    deps.db
      .insert(schema.invitations)
      .values({
        id: 'i-y',
        familyId: Y.family,
        kind: 'member',
        email: X.owner.email,
        tokenHash: 'hash-y',
        capability: 'player',
        inviterId: Y.admin.userId,
        expiresAt: '2099-01-01T00:00:00.000Z',
        createdAt: NOW,
      })
      .run();
    mail('m-owner', X.owner.email);
    mail('m-admin2', X.admin2.email);
    mail('m-player', X.player.email);
    const ids = async (actor: TestUser) =>
      ((await (await call(actor, 'GET', '/mail')).json()) as { mail: { id: string }[] }).mail.map((row) => row.id);
    expect(await ids(Y.admin)).toEqual([]);
    expect(await ids(X.admin)).toEqual(expect.arrayContaining(['m-player', X.mail]));
    expect(await ids(X.admin)).not.toContain('m-owner');
    expect(await ids(X.admin)).not.toContain('m-admin2');
    expect((await call(X.admin, 'POST', '/mail/m-owner/opened')).status).toBe(404);
    expect(await ids(X.owner)).toEqual(expect.arrayContaining(['m-owner', 'm-admin2', 'm-player']));

    // A revoked invitation's address stops being readable.
    await call(X.admin, 'DELETE', `/invites/${X.invite}`);
    expect(await ids(X.admin)).not.toContain(X.mail);
  });
});
