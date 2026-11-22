import { z } from 'zod';
import type { SceneBatchMatchResult } from './worker-result.js';

const vector = z.array(z.number().finite()).min(1).max(16384);
const embedding = z.object({ model: z.string().min(1), vector });
const crop = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.number().int().positive(),
  z.number().int().positive(),
]);
const result = z.object({
  mock_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.object({
    pack: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .refine((value) => !value.includes('..')),
    kind: z.literal('sprite'),
    facing: z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']),
  }),
  query: embedding,
  candidates: z
    .array(embedding.extend({ id: z.string().min(1), source_sha256: z.string().regex(/^[a-f0-9]{64}$/) }))
    .max(1000),
  examined: z.number().int().nonnegative().max(1000),
  eligible: z.number().int().nonnegative(),
  truncated: z.boolean(),
  regions: z
    .array(z.object({ crop, query: embedding }))
    .min(1)
    .max(32),
});

/** Decode local worker JSON before passing it to reviewed placement. */
export function parseSceneBatchMatch(value: unknown): SceneBatchMatchResult {
  return result.parse(value);
}
