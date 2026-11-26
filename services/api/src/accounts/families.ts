import { randomUUID } from 'node:crypto';

import type { Principal } from '@ogm/contracts';
import type { Db } from '@ogm/db';
import { schema } from '@ogm/db';
import { and, eq, inArray } from 'drizzle-orm';

import type { Actor, Authorization } from '@ogm/policy';

import { HttpError } from '../app/errors.js';

type UserPrincipal = Extract<Principal, { kind: 'user' }>;

export function actorFromPrincipal(principal: UserPrincipal): Actor {
  return {
    userId: principal.userId,
    familyId: principal.familyId,
    platformRole: principal.platformRole,
    capability: principal.capability,
  };
}

export function requireAuthorization(result: Authorization): void {
  if (!result.ok) throw new HttpError(403, result.reason);
}

export function createFamily(db: Db, input: { userId: string; name: string; now?: string }) {
  const existing = db
    .select({ familyId: schema.familyMembers.familyId })
    .from(schema.familyMembers)
    .where(eq(schema.familyMembers.userId, input.userId))
    .get();
  if (existing) throw new HttpError(409, 'already_in_family');

  const family = {
    id: `f_${randomUUID()}`,
    name: input.name,
    ownerUserId: input.userId,
    createdAt: input.now ?? new Date().toISOString(),
  };
  db.transaction((tx) => {
    tx.insert(schema.families).values(family).run();
    tx.insert(schema.familyMembers)
      .values({
        familyId: family.id,
        userId: input.userId,
        role: 'owner',
        capability: 'creator',
        joinedAt: family.createdAt,
      })
      .run();
  });
  return { id: family.id, name: family.name };
}

export function familyForUser(db: Db, userId: string) {
  return db
    .select({
      id: schema.families.id,
      name: schema.families.name,
      role: schema.familyMembers.role,
      capability: schema.familyMembers.capability,
    })
    .from(schema.familyMembers)
    .innerJoin(schema.families, eq(schema.familyMembers.familyId, schema.families.id))
    .where(eq(schema.familyMembers.userId, userId))
    .get();
}

export function listMembers(db: Db, familyId: string) {
  return db
    .select({
      userId: schema.familyMembers.userId,
      role: schema.familyMembers.role,
      capability: schema.familyMembers.capability,
    })
    .from(schema.familyMembers)
    .where(eq(schema.familyMembers.familyId, familyId))
    .all();
}

export function removeMember(db: Db, familyId: string, userId: string): void {
  const family = db.select().from(schema.families).where(eq(schema.families.id, familyId)).get();
  if (!family) throw new HttpError(404, 'family_not_found');
  if (family.ownerUserId === userId) throw new HttpError(409, 'owner_immutable');
  db.transaction((tx) => {
    const familyGames = tx
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.familyId, familyId));
    tx.delete(schema.gameEarlyAccess)
      .where(and(eq(schema.gameEarlyAccess.userId, userId), inArray(schema.gameEarlyAccess.gameId, familyGames)))
      .run();
    tx.delete(schema.familyMembers)
      .where(and(eq(schema.familyMembers.familyId, familyId), eq(schema.familyMembers.userId, userId)))
      .run();
  });
}

export function setRole(db: Db, familyId: string, userId: string, role: 'admin' | 'member'): void {
  const family = db
    .select({ ownerUserId: schema.families.ownerUserId })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();
  if (!family) throw new HttpError(404, 'family_not_found');
  if (family.ownerUserId === userId) throw new HttpError(409, 'owner_immutable');
  db.update(schema.familyMembers)
    .set({ role })
    .where(and(eq(schema.familyMembers.familyId, familyId), eq(schema.familyMembers.userId, userId)))
    .run();
}

export function setCapability(db: Db, familyId: string, userId: string, capability: 'creator' | 'player'): void {
  db.update(schema.familyMembers)
    .set({ capability })
    .where(and(eq(schema.familyMembers.familyId, familyId), eq(schema.familyMembers.userId, userId)))
    .run();
}
