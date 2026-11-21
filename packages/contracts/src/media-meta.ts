import { z } from 'zod';

export const MediaMeta = z
  .object({
    kind: z.enum(['pack original', 'image generation', '3D model render', '3D→2D sprite', 'in-game capture']),
    model: z.string().trim().min(1).max(200).optional(),
    cost_usd: z.number().nonnegative().nullable().optional(),
    skill: z.string().trim().min(1).max(200).optional(),
    tool: z.string().trim().min(1).max(200).optional(),
    created_at: z.string().datetime().optional(),
    ai_generated: z.boolean().optional(),
  })
  .strict();

export const MediaLayout = z
  .object({ row: z.string().trim().min(1).max(100), stage: z.enum(['original', '3d', '2d', 'candidate']).optional() })
  .strict();

export type MediaMeta = z.infer<typeof MediaMeta>;
export type MediaLayout = z.infer<typeof MediaLayout>;
