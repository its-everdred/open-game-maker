import { z } from 'zod';

export const PARTICLE_LIMITS = {
  visible: 300,
  emitters: 8,
  soft: 80,
  rate: 60,
} as const;

const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const rangeSchema = z.tuple([z.number().finite(), z.number().finite()]).refine(([min, max]) => min <= max);

export const particleEffectSchema = z
  .strictObject({
    seed: z.number().int().safe(),
    family: z.enum(['pixel', 'soft']),
    texture: z.string().min(1).optional(),
    palette: z.array(z.string().min(1)).min(1).optional(),
    emitter: z.discriminatedUnion('shape', [
      z.strictObject({ shape: z.literal('point') }),
      z.strictObject({ shape: z.literal('box'), size: vec3Schema }),
      z.strictObject({ shape: z.literal('circle'), radius: z.number().finite().nonnegative() }),
    ]),
    count: z.number().int().min(0).max(PARTICLE_LIMITS.visible),
    rate: z.number().finite().min(0).max(PARTICLE_LIMITS.rate),
    lifetime: rangeSchema.refine(([min]) => min > 0, 'lifetime must be positive'),
    velocity: z.strictObject({ x: rangeSchema, y: rangeSchema, z: rangeSchema }),
    gravity: vec3Schema,
    windResponse: z.number().finite().min(0).max(4),
    depthBand: rangeSchema.refine(([min, max]) => min >= 0 && max <= 1, 'depth band must lie in [0, 1]'),
    quality: z.enum(['off', 'low', 'high']),
  })
  .refine((effect) => effect.family !== 'soft' || effect.count <= PARTICLE_LIMITS.soft, {
    message: `soft particle count cannot exceed ${PARTICLE_LIMITS.soft}`,
    path: ['count'],
  })
  .refine((effect) => effect.texture !== undefined || effect.palette !== undefined, {
    message: 'a texture or palette reference is required',
    path: ['texture'],
  });

export type ParticleEffect = z.infer<typeof particleEffectSchema>;
