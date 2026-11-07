import { z } from 'zod';

import { Id, IsoTime } from './api.js';

// A design decision is one answered aiur Command from a game's New Game design conversation. The player's answer and
// the provisional default both land here; `origin` says which one it was and `skipped` records a player who took the
// recommendation without choosing. A later answer is a new decision whose `supersedes` names the earlier one: the aiur
// Command keeps the answer it was given, and the decision history is what the Executor re-plans from.
const DecisionIdentifier = z.string().regex(/^D-[0-9]{2,}$/);
const OptionId = z.string().regex(/^[a-z0-9_-]{1,32}$/);

export const DesignDecisionOption = z.object({
  id: OptionId,
  label: z.string().trim().min(1).max(200),
});

export const DesignDecision = z.object({
  id: DecisionIdentifier,
  game_id: Id,
  job_id: Id,
  // The aiur ticket the Command belongs to, as the Commands inbox models it; null until the job is linked.
  ticket: z.string().trim().min(1).max(40).nullable(),
  checkpoint_id: z.string().min(1).max(200),
  decision_id: z.string().min(1).max(200),
  question: z.string().trim().min(1).max(8000),
  options: z.array(DesignDecisionOption).min(2).max(12),
  recommended: OptionId.nullable(),
  chosen: OptionId,
  origin: z.enum(['player', 'default']),
  skipped: z.boolean(),
  affects: z.array(z.string().trim().min(1).max(200)).max(20),
  supersedes: DecisionIdentifier.nullable(),
  at: IsoTime,
});

// What the player reads: the question, the answer that now stands and whether it was theirs or a default.
export const DesignDecisionSummary = z.object({
  id: DecisionIdentifier,
  question: z.string().trim().min(1).max(8000),
  chosen: OptionId,
  chosen_label: z.string().trim().min(1).max(200),
  origin: z.enum(['player', 'default']),
  skipped: z.boolean(),
  supersedes: DecisionIdentifier.nullable(),
  at: IsoTime,
});

export type DesignDecisionOption = z.infer<typeof DesignDecisionOption>;
export type DesignDecision = z.infer<typeof DesignDecision>;
export type DesignDecisionSummary = z.infer<typeof DesignDecisionSummary>;

// GET /internal/games/:gameId/design-decisions → the whole history, oldest first.
export const DesignDecisionsPage = z.object({ decisions: z.array(DesignDecision) });
// GET /api/v1/games/:gameId/design-decisions → the player's readable summary, oldest first.
export const DesignDecisionSummariesPage = z.object({ decisions: z.array(DesignDecisionSummary) });

export type DesignDecisionsPage = z.infer<typeof DesignDecisionsPage>;
export type DesignDecisionSummariesPage = z.infer<typeof DesignDecisionSummariesPage>;

// The emit script picks up `<lowercase>Schemas` maps, so the multiword family follows `design-log.ts`'s pattern: the
// lowercase name is what gets emitted and the readable name is the alias.
export const designdecisionsSchemas = {
  'design-decisions.history.v1': DesignDecisionsPage,
  'design-decisions.summary.v1': DesignDecisionSummariesPage,
} satisfies Record<string, z.ZodType>;
export const designDecisionsSchemas = designdecisionsSchemas;
