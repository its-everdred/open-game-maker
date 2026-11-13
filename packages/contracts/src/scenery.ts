import { z } from 'zod';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const positiveVector = z.tuple([
  z.number().finite().positive(),
  z.number().finite().positive(),
  z.number().finite().positive(),
]);

/** The persistent, renderer-independent scene shared by the editor and agents. */
export const ScenerySchema = z
  .strictObject({
    version: z.literal(1),
    dimension: z.enum(['2d', '3d']).optional(),
    viewport: z
      .strictObject({ width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) })
      .optional(),
    items: z.array(
      z.strictObject({
        id: z.string().min(1),
        assetId: z.string().min(1),
        position: vector,
        rotation: vector,
        scale: positiveVector,
        layer: z.enum(['back', 'mid', 'front']),
        parallax: z.number().finite().optional(),
      }),
    ),
    backdrop: z
      .strictObject({
        assetId: z.string().min(1),
        landscape: z.strictObject({
          fit: z.enum(['cover', 'contain']),
          anchor: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
        }),
        portrait: z.strictObject({
          fit: z.enum(['cover', 'contain']),
          anchor: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
        }),
      })
      .optional(),
    terrain: z.array(
      z.strictObject({
        id: z.string().min(1),
        kind: z.enum(['grass', 'path', 'water']),
        points: z.array(vector).min(2),
        width: z.number().finite().positive(),
      }),
    ),
    lighting: z.enum(['warm-forest', 'night', 'cave']),
    camera: z.strictObject({ position: vector, target: vector, zoom: z.number().finite().positive() }),
  })
  .superRefine((scene, ctx) => {
    for (const key of ['items', 'terrain'] as const) {
      const seen = new Set<string>();
      scene[key].forEach((entry, index) => {
        if (seen.has(entry.id)) ctx.addIssue({ code: 'custom', path: [key, index, 'id'], message: 'duplicate id' });
        seen.add(entry.id);
      });
    }
  });

export type Scenery = z.infer<typeof ScenerySchema>;

/** Validate a scene and reject references absent from the game's asset lock. */
export function parseScenery(input: unknown, assets: readonly { id: string }[]): Scenery {
  const scene = ScenerySchema.parse(input);
  const locked = new Set(assets.map((asset) => asset.id));
  const missing = scene.items.find((item) => !locked.has(item.assetId));
  if (missing) throw new Error(`Scenery asset is not in the lock: ${missing.assetId}`);
  if (scene.backdrop && !locked.has(scene.backdrop.assetId))
    throw new Error(`Scenery asset is not in the lock: ${scene.backdrop.assetId}`);
  return scene;
}
