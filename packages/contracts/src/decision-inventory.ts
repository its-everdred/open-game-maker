import { z } from 'zod';

const DecisionOption = z
  .object({
    label: z.string().trim().min(1),
    media: z.string().trim().min(1).optional(),
    media_needed: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((option) => Number(option.media !== undefined) + Number(option.media_needed !== undefined) === 1, {
    message: 'each option needs exactly one of media or media_needed',
  });

export const CreatorDecision = z
  .object({
    id: z.string().trim().min(1).max(80),
    command_id: z
      .string()
      .regex(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
      .nullable()
      .optional(),
    area: z.string().trim().min(1).max(120),
    question: z.string().trim().min(1).max(120),
    why: z.string().trim().min(1).max(500),
    options: z.array(DecisionOption),
    recommendation: z.string().trim().min(1),
    sources: z.array(z.string().trim().min(1)),
    phase: z.enum(['mock', 'prototype', 'build', 'polish']).optional(),
    ticket: z.number().int().positive().nullable(),
    status: z.enum(['open', 'asked', 'answered', 'defaulted']),
    answer: z.string().trim().min(1).nullable().default(null),
    answered_at: z
      .union([z.string().datetime({ offset: true }), z.iso.date()])
      .nullable()
      .default(null),
    /* What an approved round left to build on (#1311): files, the generator that made them, and how to reuse them. */
    reuse: z
      .object({
        paths: z.array(z.string().trim().min(1)).min(1),
        generator: z.string().trim().min(1).optional(),
        notes: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough()
  .superRefine((entry, ctx) => {
    const legacy = typeof entry.mode === 'string';
    if (!legacy && entry.options.length < (entry.status === 'answered' ? 1 : 2))
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'decision needs more options' });
    if (!legacy && entry.status === 'asked' && entry.options.some((option) => !option.media))
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'asked decisions need media on every option' });
    if (entry.status === 'answered' && (!entry.answer || !entry.answered_at))
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'answered decisions need answer and answered_at' });
    if (entry.status !== 'answered' && (entry.answer !== null || entry.answered_at !== null))
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'unanswered decisions need null answer fields' });
    const optionAnswer =
      entry.answer &&
      entry.options.some((option) => entry.answer === option.label || entry.answer?.startsWith(`${option.label}:`));
    const noteOnlyAnswer = entry.status === 'answered' && entry.answer !== null && !optionAnswer;
    if (entry.answer && !optionAnswer && !noteOnlyAnswer)
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'must match an option label' });
  });

export const DecisionInventory = z.array(CreatorDecision).superRefine((inventory, ctx) => {
  const seen = new Set<string>();
  inventory.forEach((entry, index) => {
    if (seen.has(entry.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `duplicate id ${entry.id}` });
    seen.add(entry.id);
  });
});

export type CreatorDecision = z.infer<typeof CreatorDecision>;
export type DecisionInventory = z.infer<typeof DecisionInventory>;

/** Questions in one first-playable plan must have one stable owner. */
export function duplicateDecisionQuestions(inventory: DecisionInventory): { first: string; second: string }[] {
  const seen = new Map<string, string>();
  const duplicates: { first: string; second: string }[] = [];
  for (const entry of inventory) {
    const key = `${entry.area.trim().toLowerCase()}\u0000${entry.question.trim().toLowerCase()}`;
    const first = seen.get(key);
    if (first) duplicates.push({ first, second: entry.id });
    else seen.set(key, entry.id);
  }
  return duplicates;
}

export const decisioninventorySchemas = {
  'decision-inventory.v1': DecisionInventory,
} satisfies Record<string, z.ZodType>;
