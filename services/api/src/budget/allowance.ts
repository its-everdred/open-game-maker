import { schema, type Db } from '@ogm/db';
import { and, eq } from 'drizzle-orm';

import { dayKey, nextReset } from './reset.js';
import { dailyAllowance, getBudgetSettings, type BudgetDefaults } from './settings.js';

type Charge = { reservation: number; release: number; usage: number; adjustment: number };

function charges(db: Db, familyId: string, key: string, userId?: string): number {
  const where = userId
    ? and(
        eq(schema.budgetLedger.familyId, familyId),
        eq(schema.budgetLedger.userId, userId),
        eq(schema.budgetLedger.dayKey, key),
      )
    : and(eq(schema.budgetLedger.familyId, familyId), eq(schema.budgetLedger.dayKey, key));
  return netCharges(db.select().from(schema.budgetLedger).where(where).all());
}

// A job's charge: its open reservation, plus usage beyond it, plus adjustments.
export function netCharges(rows: readonly { jobId: string; kind: keyof Charge; amountMicroUsd: number }[]): number {
  const byJob = new Map<string, Charge>();
  for (const row of rows) {
    const charge = byJob.get(row.jobId) ?? { reservation: 0, release: 0, usage: 0, adjustment: 0 };
    charge[row.kind] += row.amountMicroUsd;
    byJob.set(row.jobId, charge);
  }
  return [...byJob.values()].reduce(
    (total, charge) =>
      total +
      Math.max(0, charge.reservation - charge.release) +
      Math.max(0, charge.usage - charge.reservation) +
      charge.adjustment,
    0,
  );
}

export function allowanceRemaining(input: {
  db: Db;
  familyId: string;
  userId: string;
  now: Date;
  defaults: BudgetDefaults;
}) {
  const settings = getBudgetSettings(input.db, input.familyId, input.defaults);
  const dailyMicroUsd = dailyAllowance(input.db, input.familyId, input.userId, input.defaults);
  return {
    dailyMicroUsd,
    remainingMicroUsd: Math.max(
      0,
      dailyMicroUsd - charges(input.db, input.familyId, dayKey(input.now, settings.resetZone), input.userId),
    ),
    resetsAt: nextReset(input.now, settings.resetZone).toISOString(),
  };
}

export function familyDayTotal(db: Db, familyId: string, now: Date, defaults: BudgetDefaults): number {
  const settings = getBudgetSettings(db, familyId, defaults);
  return charges(db, familyId, dayKey(now, settings.resetZone));
}

export function platformRemaining(db: Db, familyId: string, now: Date, defaults: BudgetDefaults): number {
  const settings = getBudgetSettings(db, familyId, defaults);
  return Math.max(0, settings.platformCapMicroUsd - familyDayTotal(db, familyId, now, defaults));
}
