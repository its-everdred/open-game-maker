import { actionValueSchema } from '@ogm/contracts';
import { z } from 'zod';

import { inputScriptSchema } from './inputs.js';

/** Logical game actions or a click on an HTML control at a deterministic game time. */
export const trailerInputSchema = z.union([
  inputScriptSchema.element.extend({ value: actionValueSchema.optional() }),
  z.strictObject({ t: z.number().min(0), click: z.string().min(1).max(256) }),
]);
export type TrailerInput = z.output<typeof trailerInputSchema>;
