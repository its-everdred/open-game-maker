import { describe, expect, it } from 'vitest';

import { authorize, type Actor } from '../src/index.js';

const creator: Actor = {
  userId: 'creator',
  familyId: 'family-a',
  platformRole: 'none',
  capability: 'creator',
};
const admin: Actor = { ...creator, userId: 'admin', platformRole: 'admin' };
const maintainer: Actor = { ...creator, userId: 'maintainer', platformRole: 'maintainer' };

describe('deny-wins precedence', () => {
  it('denies cross-family actions even for a maintainer with audit enabled', () => {
    expect(
      authorize(maintainer, 'game.edit', {
        familyId: 'family-b',
        ownerId: 'another-user',
        audit: true,
      }),
    ).toEqual({ ok: false, reason: 'cross_family' });
  });

  it('requires audit for a maintainer helping with another owner game', () => {
    const resource = { familyId: 'family-a', ownerId: 'another-user' };
    expect(authorize(maintainer, 'game.edit', resource)).toEqual({ ok: false, reason: 'audit_required' });
    expect(authorize(maintainer, 'game.edit', { ...resource, audit: true })).toEqual({ ok: true, reason: 'audited' });
  });

  it('fails closed when an owner action omits the owner', () => {
    expect(authorize(maintainer, 'game.publish', { familyId: 'family-a', audit: true })).toEqual({
      ok: false,
      reason: 'owner_required',
    });
  });

  it('does not let an admin edit another adult game', () => {
    expect(authorize(admin, 'game.edit', { familyId: 'family-a', ownerId: 'creator' })).toEqual({
      ok: false,
      reason: 'not_owner',
    });
  });

  it('lets creators invite players or room guests but not family members', () => {
    const base = { familyId: 'family-a' };
    expect(authorize(creator, 'member.invite', { ...base, inviteKind: 'play' })).toEqual({ ok: true });
    expect(authorize(creator, 'member.invite', { ...base, inviteKind: 'room' })).toEqual({ ok: true });
    expect(authorize(creator, 'member.invite', { ...base, inviteKind: 'member' })).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });

  it('requires ownership or an explicit grant to play a private game', () => {
    const base = { familyId: 'family-a', ownerId: 'another-user', visibility: 'private' as const };
    expect(authorize(creator, 'game.play', base)).toEqual({ ok: false, reason: 'private_game' });
    expect(authorize(creator, 'game.play', { ...base, granted: true })).toEqual({ ok: true });
    expect(authorize(creator, 'game.play', { ...base, ownerId: creator.userId })).toEqual({ ok: true });
  });

  it('restricts coming soon games to owners, admins, and grant holders', () => {
    const base = {
      familyId: 'family-a',
      ownerId: 'another-user',
      visibility: 'listed' as const,
      releaseState: 'coming_soon' as const,
    };
    expect(authorize(creator, 'game.play', base)).toEqual({ ok: false, reason: 'coming_soon' });
    expect(authorize(creator, 'game.play', { ...base, granted: true })).toEqual({ ok: true });
    expect(authorize(creator, 'game.play', { ...base, ownerId: creator.userId })).toEqual({ ok: true });
    expect(authorize(admin, 'game.play', base)).toEqual({ ok: true });
    expect(authorize(admin, 'game.play', { ...base, familyId: 'family-b' })).toEqual({
      ok: false,
      reason: 'cross_family',
    });
  });

  it('fails closed when game visibility or invitation kind is missing', () => {
    expect(authorize(creator, 'game.play', { familyId: 'family-a', ownerId: creator.userId })).toEqual({
      ok: false,
      reason: 'visibility_required',
    });
    expect(authorize(admin, 'member.invite', { familyId: 'family-a' })).toEqual({
      ok: false,
      reason: 'invite_kind_required',
    });
  });
});
