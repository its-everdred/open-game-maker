import type { FamilyBudgetSettings } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, eq } from 'drizzle-orm';

export type BudgetDefaults = { dailyAllowanceMicroUsd: number; resetZone: string; creatorJobLimit?: number };

export function dailyAllowance(db: Db, familyId: string, userId: string, defaults: BudgetDefaults): number {
  return (
    db
      .select({ dailyMicroUsd: schema.allowances.dailyMicroUsd })
      .from(schema.allowances)
      .where(and(eq(schema.allowances.familyId, familyId), eq(schema.allowances.userId, userId)))
      .get()?.dailyMicroUsd ?? defaults.dailyAllowanceMicroUsd
  );
}

export function getBudgetSettings(db: Db, familyId: string, defaults: BudgetDefaults): FamilyBudgetSettings {
  const stored = db
    .select()
    .from(schema.familyBudgetSettings)
    .where(eq(schema.familyBudgetSettings.familyId, familyId))
    .get();
  const members = db
    .select({ dailyMicroUsd: schema.allowances.dailyMicroUsd })
    .from(schema.familyMembers)
    .leftJoin(
      schema.allowances,
      and(
        eq(schema.allowances.familyId, schema.familyMembers.familyId),
        eq(schema.allowances.userId, schema.familyMembers.userId),
      ),
    )
    .where(eq(schema.familyMembers.familyId, familyId))
    .all();
  const defaultPlatformCap = Math.max(
    defaults.dailyAllowanceMicroUsd,
    members.reduce((total, member) => total + (member.dailyMicroUsd ?? defaults.dailyAllowanceMicroUsd), 0),
  );

  return {
    familyId,
    resetZone: stored?.resetZone ?? defaults.resetZone,
    unitLabel: stored?.unitLabel ?? 'energy',
    microUsdPerUnit: stored?.microUsdPerUnit ?? 100_000,
    platformCapMicroUsd: stored?.platformCapMicroUsd ?? defaultPlatformCap,
    slots: { new_game: stored?.slotsNewGame ?? 1, edit: stored?.slotsEdit ?? 3 },
    hardCapMultiplier: stored?.hardCapMultiplier ?? 1,
  };
}
