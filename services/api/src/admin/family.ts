import { schema } from '@ogm/db';
import type { Actor } from '@ogm/policy';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import { HttpError } from '../app/errors.js';
import type { AppDeps } from '../app/types.js';
import { allowanceRemaining, familyDayTotal } from '../budget/allowance.js';
import { nextReset } from '../budget/reset.js';
import { getBudgetSettings, type BudgetDefaults } from '../budget/settings.js';
import { SLOT_STATES } from '../jobs/state.js';
import type { BudgetOverview, MemberRow } from './shapes.js';

type Member = typeof schema.familyMembers.$inferSelect;

export const budgetDefaults = (deps: AppDeps): BudgetDefaults => ({
  dailyAllowanceMicroUsd: deps.config.defaultDailyAllowanceMicroUsd,
  defaultAllowanceConfigured: deps.config.defaultDailyAllowanceConfigured,
  resetZone: deps.config.resetZoneDefault,
});

export function familyMember(deps: AppDeps, familyId: string, userId: string): Member {
  const member = deps.db
    .select()
    .from(schema.familyMembers)
    .where(and(eq(schema.familyMembers.familyId, familyId), eq(schema.familyMembers.userId, userId)))
    .get();
  if (!member) throw new HttpError(404, 'member_not_found');
  return member;
}

// The owner may change or remove anyone but themselves; other admins may not touch a peer admin.
export function requireMayManage(deps: AppDeps, actor: Actor, target: Member): void {
  if (target.role === 'owner') throw new HttpError(409, 'owner_immutable');
  if (target.role !== 'admin' || target.userId === actor.userId) return;
  const family = deps.db
    .select({ ownerUserId: schema.families.ownerUserId })
    .from(schema.families)
    .where(eq(schema.families.id, target.familyId))
    .get();
  if (family?.ownerUserId !== actor.userId) throw new HttpError(403, 'owner_only');
}

export async function emailsFor(deps: AppDeps, userIds: string[]): Promise<Map<string, string | null>> {
  const directory = deps.registry.userDirectory;
  if (!directory) throw new HttpError(503, 'user_directory_unavailable');
  const emails = await Promise.all(userIds.map(async (id) => [id, await directory.emailForUser(id)] as const));
  return new Map(emails);
}

export async function memberRows(deps: AppDeps, familyId: string, now: Date): Promise<MemberRow[]> {
  const members = deps.db
    .select()
    .from(schema.familyMembers)
    .where(eq(schema.familyMembers.familyId, familyId))
    .orderBy(asc(schema.familyMembers.joinedAt))
    .all();
  const emails = await emailsFor(
    deps,
    members.map((member) => member.userId),
  );
  return members.map((member) => {
    const allowance = allowanceRemaining({
      db: deps.db,
      familyId,
      userId: member.userId,
      now,
      defaults: budgetDefaults(deps),
    });
    return {
      userId: member.userId,
      email: emails.get(member.userId) ?? '',
      role: member.role,
      capability: member.capability,
      joinedAt: member.joinedAt,
      dailyMicroUsd: allowance.dailyMicroUsd,
      remainingMicroUsd: allowance.remainingMicroUsd,
    };
  });
}

export function settingsResponse(deps: AppDeps, familyId: string) {
  const family = deps.db
    .select({ friendsAllowed: schema.families.friendsAllowed })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .get();
  return {
    ...getBudgetSettings(deps.db, familyId, budgetDefaults(deps)),
    friendsAllowed: family?.friendsAllowed ?? false,
  };
}

export async function budgetOverview(deps: AppDeps, familyId: string, now: Date): Promise<BudgetOverview> {
  const settings = getBudgetSettings(deps.db, familyId, budgetDefaults(deps));
  const held = deps.db
    .select({ slot: schema.jobs.slot, count: sql<number>`count(*)` })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.familyId, familyId), inArray(schema.jobs.state, SLOT_STATES)))
    .groupBy(schema.jobs.slot)
    .all();
  const inUse = { new_game: 0, edit: 0 };
  for (const row of held) inUse[row.slot] = row.count;
  const queued = deps.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.familyId, familyId), eq(schema.jobs.state, 'queued')))
    .orderBy(asc(schema.jobs.createdAt))
    .all()
    .map((job) => job.id);
  return {
    familyDayMicroUsd: familyDayTotal(deps.db, familyId, now, budgetDefaults(deps)),
    platformCapMicroUsd: settings.platformCapMicroUsd,
    resetsAt: nextReset(now, settings.resetZone).toISOString(),
    unitLabel: settings.unitLabel,
    microUsdPerUnit: settings.microUsdPerUnit,
    slots: settings.slots,
    inUse,
    queued,
    members: await memberRows(deps, familyId, now),
  };
}

// `mail_outbox` has no family column, so whose mail an admin may read is decided by address:
// - members' mail, except that only the owner reads other admins' (their sign-in links are their accounts);
// - a pending invitation's address, only while no account owns it, so inviting someone else's address
//   never exposes their sign-in links.
export async function familyRecipients(deps: AppDeps, actor: Actor, now = new Date()): Promise<string[]> {
  const family = deps.db
    .select({ ownerUserId: schema.families.ownerUserId })
    .from(schema.families)
    .where(eq(schema.families.id, actor.familyId))
    .get();
  const isOwner = family?.ownerUserId === actor.userId;
  const members = deps.db
    .select({ userId: schema.familyMembers.userId, role: schema.familyMembers.role })
    .from(schema.familyMembers)
    .where(eq(schema.familyMembers.familyId, actor.familyId))
    .all()
    .filter((member) => isOwner || member.role === 'member' || member.userId === actor.userId);
  const emails = [
    ...(
      await emailsFor(
        deps,
        members.map((member) => member.userId),
      )
    ).values(),
  ];
  const pending = deps.db
    .select({ email: schema.invitations.email })
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.familyId, actor.familyId),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
        gt(schema.invitations.expiresAt, now.toISOString()),
      ),
    )
    .all();
  const directory = deps.registry.userDirectory!;
  for (const { email } of pending) {
    if ((await directory.userIdForEmail(email)) === null) emails.push(email);
  }
  return [...new Set(emails.filter((email): email is string => Boolean(email)).map((email) => email.toLowerCase()))];
}
