import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { removeMember, setRole } from '../src/accounts/families.js';
import { asUser, installUsers, makeApp, makeDeps, type TestUser } from './helpers.js';

const owner: TestUser = {
  kind: 'user',
  userId: 'u-owner',
  displayName: 'Owner',
  email: 'owner@example.com',
  familyId: '',
  platformRole: 'admin',
  capability: 'creator',
};

describe('accounts routes', () => {
  it('creates the caller first family and returns it from me and members', async () => {
    const deps = makeDeps();
    installUsers(deps, [owner]);
    const { app } = await makeApp(deps);

    const created = await app.request('/api/v1/families', {
      method: 'POST',
      headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Our House' }),
    });
    expect(created.status).toBe(201);
    const family = (await created.json()) as { id: string; name: string };
    expect(family).toMatchObject({ name: 'Our House' });

    const me = await app.request('/api/v1/me', { headers: asUser(owner.userId) });
    expect(await me.json()).toEqual({
      user: { id: owner.userId, email: owner.email },
      family: { id: family.id, name: 'Our House', role: 'owner', capability: 'creator' },
      platformRole: 'admin',
      capability: 'creator',
    });

    const members = await app.request(`/api/v1/families/${family.id}/members`, {
      headers: asUser(owner.userId),
    });
    expect(await members.json()).toEqual({
      members: [{ userId: owner.userId, role: 'owner', capability: 'creator', email: owner.email }],
    });

    expect(() => removeMember(deps.db, family.id, owner.userId)).toThrowError(
      expect.objectContaining({ status: 409, code: 'owner_immutable' }),
    );
    expect(() => setRole(deps.db, family.id, owner.userId, 'member')).toThrowError(
      expect.objectContaining({ status: 409, code: 'owner_immutable' }),
    );
  });

  it('refuses a second family for the same user', async () => {
    const deps = makeDeps();
    installUsers(deps, [owner]);
    const { app } = await makeApp(deps);
    const request = () =>
      app.request('/api/v1/families', {
        method: 'POST',
        headers: { ...asUser(owner.userId), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Our House' }),
      });
    expect((await request()).status).toBe(201);
    const duplicate = await request();
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'already_in_family' });
  });

  it('denies cross-family member listing', async () => {
    const deps = makeDeps();
    const caller = { ...owner, familyId: 'f-a' };
    installUsers(deps, [caller]);
    deps.db
      .insert(schema.families)
      .values([
        { id: 'f-a', name: 'A', ownerUserId: caller.userId, createdAt: '2026-11-01T00:00:00.000Z' },
        { id: 'f-b', name: 'B', ownerUserId: 'u-b', createdAt: '2026-11-01T00:00:00.000Z' },
      ])
      .run();
    deps.db
      .insert(schema.familyMembers)
      .values({
        familyId: 'f-a',
        userId: caller.userId,
        role: 'owner',
        capability: 'creator',
        joinedAt: '2026-11-01T00:00:00.000Z',
      })
      .run();
    const { app } = await makeApp(deps);
    const response = await app.request('/api/v1/families/f-b/members', { headers: asUser(caller.userId) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'cross_family' });
  });
});
