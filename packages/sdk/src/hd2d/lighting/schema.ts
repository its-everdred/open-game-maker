import { z } from 'zod';

const ColorSchema = z.string().regex(/^#[\da-fA-F]{6}$/);

export const LightingQualitySchema = z.enum(['off', 'low', 'high']);
export type LightingQuality = z.infer<typeof LightingQualitySchema>;

export const LightingPresetSchema = z.object({
  ambient: z.object({ color: ColorSchema, intensity: z.number().min(0).max(1) }),
  grade: z
    .object({
      temperature: z.number().min(-1).max(1),
      saturation: z.number().min(0).max(2),
      contrast: z.number().min(0).max(2),
    })
    .optional(),
  shafts: z
    .object({
      direction: z.number(),
      color: ColorSchema,
      intensity: z.number().min(0).max(1),
      mask: z.string().optional(),
    })
    .optional(),
  dapple: z
    .object({
      mask: z.string(),
      scale: z.number().positive(),
      speed: z.number().min(0),
      intensity: z.number().min(0).max(1),
    })
    .optional(),
  lights: z
    .array(
      z.object({
        id: z.string().min(1),
        x: z.number(),
        y: z.number(),
        radius: z.number().positive(),
        color: ColorSchema,
        intensity: z.number().min(0).max(1),
        falloff: z.number().min(0).optional(),
        flicker: z
          .object({
            amount: z.number().min(0).max(1),
            rate: z.number().positive(),
            seed: z.number().int(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export type LightingPreset = z.infer<typeof LightingPresetSchema>;

export const DEFAULT_FOREST_LIGHTING: LightingPreset = {
  ambient: { color: '#a6b98b', intensity: 0.42 },
  grade: { temperature: 0.12, saturation: 0.9, contrast: 1.04 },
  shafts: { direction: 1.32, color: '#ffe7a1', intensity: 0.34 },
  dapple: { mask: 'canopy', scale: 0.25, speed: 0.08, intensity: 0.53 },
  lights: [],
};

export function maxLightsFor(quality: LightingQuality): number {
  switch (quality) {
    case 'off':
      return 0;
    case 'low':
      return 4;
    case 'high':
      return 8;
  }
}
