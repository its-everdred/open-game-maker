import { z } from 'zod';

const Region = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    layer: z.enum(['ground', 'background', 'landmark', 'prop', 'character', 'light', 'effect']),
    bounds: z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const Brief = z
  .object({
    image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    story: z.string().trim().min(1).max(2000),
    mood: z.string().trim().min(1).max(500),
    light: z.string().trim().min(1).max(500),
    focalRegion: z.string().trim().min(1),
    regions: z.array(Region).min(1).max(1000),
  })
  .strict()
  .superRefine((brief, ctx) => {
    const ids = new Set<string>();
    for (const [index, region] of brief.regions.entries()) {
      if (ids.has(region.id))
        ctx.addIssue({ code: 'custom', path: ['regions', index, 'id'], message: 'duplicate region id' });
      ids.add(region.id);
      if (
        region.bounds.x + region.bounds.width > brief.image.width ||
        region.bounds.y + region.bounds.height > brief.image.height
      )
        ctx.addIssue({ code: 'custom', path: ['regions', index, 'bounds'], message: 'region exceeds image bounds' });
    }
    if (!ids.has(brief.focalRegion))
      ctx.addIssue({ code: 'custom', path: ['focalRegion'], message: 'focal region does not exist' });
  });

/** Validate a reviewed decomposition before using its image coordinates. */
export function parseSceneBrief(input: unknown) {
  return Brief.parse(input);
}
