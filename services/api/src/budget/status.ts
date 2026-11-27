import type { BudgetStatus } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { SLOT_STATES } from '../jobs/state.js';
import { allowanceRemaining } from './allowance.js';
import { getBudgetSettings, hasExplicitAllowance, type BudgetDefaults } from './settings.js';
import { weeklyJobs } from './weekly-jobs.js';

export function budgetStatus(
  deps: { db: Db; defaults: BudgetDefaults },
  input: { familyId: string; userId: string; now: Date },
): BudgetStatus {
  const settings = getBudgetSettings(deps.db, input.familyId, deps.defaults);
  const allowance = allowanceRemaining({ db: deps.db, ...input, defaults: deps.defaults });
  const weekly = weeklyJobs(deps.db, input.userId, input.now, deps.defaults.resetZone);
  const held = (slot: 'new_game' | 'edit') =>
    deps.db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.familyId, input.familyId),
          eq(schema.jobs.slot, slot),
          inArray(schema.jobs.state, SLOT_STATES),
        ),
      )
      .all().length;
  const queued = deps.db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.creatorId, input.userId), eq(schema.jobs.state, 'queued')))
    .orderBy(asc(schema.jobs.createdAt))
    .all()
    .map(({ id }) => id);
  return {
    remainingMicroUsd: allowance.remainingMicroUsd,
    dailyLimitActive: Boolean(
      deps.defaults.defaultAllowanceConfigured || hasExplicitAllowance(deps.db, input.familyId, input.userId),
    ),
    weeklyJobs: { ...weekly.remaining, resetsAt: weekly.resetsAt },
    remainingPercent:
      allowance.dailyMicroUsd > 0
        ? Math.min(100, Math.round((allowance.remainingMicroUsd / allowance.dailyMicroUsd) * 100))
        : 0,
    unitLabel: settings.unitLabel,
    resetsAt: allowance.resetsAt,
    freeSlots: {
      new_game: Math.max(0, settings.slots.new_game - held('new_game')),
      edit: Math.max(0, settings.slots.edit - held('edit')),
    },
    queued,
  };
}
