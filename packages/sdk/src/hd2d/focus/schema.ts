import { z } from 'zod';

export const focusConfigSchema = z.strictObject({
  mode: z.enum(['off', 'depthBands', 'tiltShift', 'depthOfField']),
  target: z.union([z.literal('player'), z.strictObject({ x: z.number(), y: z.number(), z: z.number().optional() })]),
  smoothing: z.number().min(0).max(1),
  strength: z.number().min(0).max(1),
  range: z.number().min(0).max(1),
  quality: z.enum(['off', 'low', 'high']),
});

export const sceneAtmosphereSchema = z.strictObject({
  haze: z
    .strictObject({
      color: z.string().regex(/^#[\da-fA-F]{6}$/),
      distance: z.number().positive().optional(),
      height: z.number().optional(),
      density: z.number().min(0).max(1).optional(),
    })
    .optional(),
  pixelArt: z
    .strictObject({
      filter: z.literal('nearest'),
      sharp: z.boolean(),
    })
    .optional(),
});

export const occlusionStyleSchema = z.strictObject({
  response: z.enum(['none', 'fade', 'fadeAndTint']),
  opacity: z.number().min(0).max(1).optional(),
});

export type FocusConfig = z.infer<typeof focusConfigSchema>;
export type SceneAtmosphere = z.infer<typeof sceneAtmosphereSchema>;
export type OcclusionStyle = z.infer<typeof occlusionStyleSchema>;

export const DEFAULT_FOCUS: FocusConfig = {
  mode: 'depthBands',
  target: 'player',
  smoothing: 0.15,
  strength: 0.6,
  range: 0.25,
  quality: 'high',
};
