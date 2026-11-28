import { z } from 'zod';

import { Id, IsoTime, MicroUsd } from './api.js';
import { Confidence, SizeClass } from './jobs.js';

const SizeClassKind = z.enum(['new_game', 'feature', 'repair']);

export const BudgetStatus = z.object({
  remainingMicroUsd: MicroUsd,
  remainingPercent: z.number().min(0).max(100),
  unitLabel: z.string(),
  resetsAt: IsoTime,
  freeSlots: z.object({ new_game: z.number().int(), edit: z.number().int() }),
  queued: z.array(Id),
  dailyLimitActive: z.boolean().optional(),
  weeklyJobs: z
    .object({
      newGames: z.number().int().nonnegative().nullable(),
      edits: z.number().int().nonnegative().nullable(),
      resetsAt: IsoTime,
    })
    .optional(),
});
export const EstimateRequest = z.object({ gameId: Id, summary: z.string().min(1).max(2000) });
export const Estimate = z.object({
  sizeClass: SizeClass,
  rangeMicroUsd: z.tuple([MicroUsd, MicroUsd]),
  confidence: Confidence,
  fits: z.boolean(),
});
export const SizeClassRow = z.object({
  kind: SizeClassKind,
  sizeClass: SizeClass,
  p50MicroUsd: MicroUsd,
  p80MicroUsd: MicroUsd,
  samples: z.number().int(),
});
export const FamilyBudgetSettings = z.object({
  familyId: Id,
  resetZone: z.string(),
  unitLabel: z.string(),
  microUsdPerUnit: MicroUsd.positive(),
  platformCapMicroUsd: MicroUsd,
  slots: z.object({ new_game: z.number().int().min(0), edit: z.number().int().min(0) }),
  hardCapMultiplier: z.number().positive(),
});
export const Allowance = z.object({
  userId: Id,
  familyId: Id,
  dailyMicroUsd: MicroUsd,
  remainingMicroUsd: MicroUsd,
  resetsAt: IsoTime,
});

export type BudgetStatus = z.infer<typeof BudgetStatus>;
export type EstimateRequest = z.infer<typeof EstimateRequest>;
export type Estimate = z.infer<typeof Estimate>;
export type SizeClassRow = z.infer<typeof SizeClassRow>;
export type FamilyBudgetSettings = z.infer<typeof FamilyBudgetSettings>;
export type Allowance = z.infer<typeof Allowance>;

export const budgetSchemas = {
  'budget.status.v1': BudgetStatus,
  'budget.estimate.request.v1': EstimateRequest,
  'budget.estimate.v1': Estimate,
  'budget.size-class-row.v1': SizeClassRow,
  'budget.settings.v1': FamilyBudgetSettings,
  'budget.allowance.v1': Allowance,
} satisfies Record<string, z.ZodType>;
