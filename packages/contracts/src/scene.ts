import { z } from 'zod';

import { IsoTime } from './api.js';

/** The newest scene document version; `migrateScene` in `@ogm/design-log` brings older files up to it. */
export const SCENE_SCHEMA_VERSION = 1;

/** Readable ids: agents write scene files by hand. */
export const SceneIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const SceneCellSchema = z.string().regex(/^-?\d+,-?\d+$/);
export const SceneLockSchema = z.literal('creator');

export const SceneTileSchema = z.strictObject({
  asset: z.string().min(1),
  /** One of the facings the pack adapter says the asset was drawn in (e.g. N/E/S/W). */
  facing: z.string().min(1).optional(),
  flip: z.boolean().optional(),
  elevation: z.number().finite().optional(),
  lockedBy: SceneLockSchema.optional(),
});
export type SceneTile = z.infer<typeof SceneTileSchema>;

export const SceneLayerSchema = z.strictObject({
  kind: z.enum(['tiles', 'objects']),
  order: z.number().int(),
  visible: z.boolean().optional(),
  /** Tiles keyed by cell `"x,y"`; only on `tiles` layers. */
  tiles: z.record(SceneCellSchema, SceneTileSchema).optional(),
  lockedBy: SceneLockSchema.optional(),
});
export type SceneLayer = z.infer<typeof SceneLayerSchema>;

export const ScenePoseSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  elevation: z.number().finite().optional(),
});

export const SceneObjectSchema = z.strictObject({
  asset: z.string().min(1),
  layer: SceneIdSchema,
  pose: ScenePoseSchema,
  /** Free rotation in degrees, for packs that rotate; drawn-facing packs use `facing`. */
  rotation: z.number().finite().optional(),
  facing: z.string().min(1).optional(),
  flip: z.boolean().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  lockedBy: SceneLockSchema.optional(),
});
export type SceneObject = z.infer<typeof SceneObjectSchema>;

/**
 * HD-2D sections. `settings` follow the core HD-2D schemas in `@gm/sdk/hd2d` (lighting preset, focus config, scene
 * atmosphere, occlusion style, particle effects by id); contracts cannot import the SDK, so `gm scene` validates them.
 */
export const SCENE_HD2D_SECTIONS = ['lighting', 'focus', 'atmosphere', 'occlusion', 'particles'] as const;
export type SceneHd2dSection = (typeof SCENE_HD2D_SECTIONS)[number];
export const SceneHd2dEntrySchema = z.strictObject({ settings: z.unknown(), lockedBy: SceneLockSchema.optional() });
export type SceneHd2dEntry = z.infer<typeof SceneHd2dEntrySchema>;

export const SceneDocSchema = z
  .strictObject({
    schemaVersion: z.literal(SCENE_SCHEMA_VERSION),
    game: SceneIdSchema,
    scene: SceneIdSchema,
    packAdapter: z.string().min(1),
    layers: z.record(SceneIdSchema, SceneLayerSchema),
    objects: z.record(SceneIdSchema, SceneObjectSchema),
    hd2d: z.partialRecord(z.enum(SCENE_HD2D_SECTIONS), SceneHd2dEntrySchema),
  })
  .superRefine((doc, ctx) => {
    for (const [id, layer] of Object.entries(doc.layers)) {
      if (layer.kind === 'objects' && layer.tiles !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['layers', id, 'tiles'], message: 'an objects layer holds no tiles' });
      }
    }
    for (const [id, object] of Object.entries(doc.objects)) {
      if (doc.layers[object.layer]?.kind !== 'objects') {
        ctx.addIssue({
          code: 'custom',
          path: ['objects', id, 'layer'],
          message: 'object layer must be an objects layer',
        });
      }
    }
  });
export type SceneDoc = z.infer<typeof SceneDocSchema>;

/** `kevin` (any creator slug) or `agent:<ticket>`. */
export const SceneAuthorSchema = z.string().regex(/^(?:agent:[1-9][0-9]{0,15}|[a-z][a-z0-9-]{0,31})$/);
export const SceneSourceSchema = z.enum(['editor', 'cli', 'migration']);
export type SceneAuthor = z.infer<typeof SceneAuthorSchema>;
export type SceneSource = z.infer<typeof SceneSourceSchema>;

/** A unit is the smallest thing that merges or locks: `meta`, `layer:<id>`, `tile:<layer>:<x,y>`, `object:<id>`, `hd2d:<section>`. */
export const SceneUnitSchema = z
  .string()
  .regex(/^(?:meta|layer:[^:]+|tile:[^:]+:-?\d+,-?\d+|object:[^:]+|hd2d:[a-z]+)$/);

export const SceneChangeSchema = z.strictObject({
  unit: SceneUnitSchema,
  /** Absent: the unit did not exist. */
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export type SceneChange = z.infer<typeof SceneChangeSchema>;

export const SceneRevisionSchema = z.strictObject({
  rev: z.number().int().positive(),
  /** The head this revision was applied on (`rev - 1`). */
  parentRev: z.number().int().nonnegative(),
  /** The revision the writer started from; below `parentRev` when it was rebased. */
  baseRev: z.number().int().nonnegative(),
  author: SceneAuthorSchema,
  source: SceneSourceSchema,
  label: z.string(),
  createdAt: IsoTime,
  changes: z.array(SceneChangeSchema),
  docHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SceneRevision = z.infer<typeof SceneRevisionSchema>;

export const SceneHeadSchema = z.strictObject({ rev: z.number().int().nonnegative(), doc: SceneDocSchema });
export type SceneHead = z.infer<typeof SceneHeadSchema>;

export const SceneConflictSchema = z.strictObject({
  unit: SceneUnitSchema,
  reason: z.enum(['creator_locked', 'changed_since_base']),
  /** The head's value the push would have replaced. */
  theirs: z.unknown().optional(),
  mine: z.unknown().optional(),
  /** Who last changed the unit, when known. */
  by: SceneAuthorSchema.optional(),
});
export type SceneConflict = z.infer<typeof SceneConflictSchema>;

export type ScenePlacementKind = 'cell' | 'edge' | 'free';
export type ScenePoint = { x: number; y: number };

/** A brush the editor offers for a pack: paints `asset` (or a family the adapter autotiles) onto a layer. */
export type SceneBrush = { id: string; label: string; layer: string; assets: readonly string[] };

/**
 * Pack-specific placement rules. The scene names its adapter by id; the editor and agents ask the adapter how an
 * asset may be placed. #1208 implements SmallScaleInt's.
 */
export interface ScenePackAdapter {
  readonly id: string;
  /** The facings the asset was drawn in; empty when it rotates freely. */
  facings(asset: string): readonly string[];
  placement(asset: string): ScenePlacementKind;
  /** Snap a world point to where `kind` placements may sit (a cell centre, an edge midpoint). */
  snap(point: ScenePoint, kind: ScenePlacementKind): ScenePoint;
  brushes(): readonly SceneBrush[];
  /** Tiles and objects to rewrite after `cells` changed on `layer`, so joins (fences, walls, shores) pick their pieces. */
  autotile?(doc: SceneDoc, layer: string, cells: readonly string[]): Pick<SceneDoc, 'layers' | 'objects'>;
}

export const SceneFamilySchema = z.looseObject({
  doc: SceneDocSchema,
  head: SceneHeadSchema,
  revision: SceneRevisionSchema,
  conflict: SceneConflictSchema,
});

export const sceneSchemas = {
  'scene.v1': SceneFamilySchema,
} satisfies Record<string, z.ZodType>;
