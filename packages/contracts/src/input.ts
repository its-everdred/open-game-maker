import { z } from 'zod';

/** Room ceiling is 8 players (D-ROOMS), so indexes run 0..7. */
export const MAX_PLAYERS = 8;
export const MAX_ACTIONS_PER_FRAME = 32;

export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof vec3Schema>;

export const insetsSchema = z.looseObject({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});
export type Insets = z.infer<typeof insetsSchema>;

export const actionValueSchema = z.union([z.boolean(), z.number(), z.looseObject({ x: z.number(), y: z.number() })]);
export type ActionValue = z.infer<typeof actionValueSchema>;

export const actionFrameSchema = z.looseObject({
  playerIndex: z
    .number()
    .int()
    .min(0)
    .max(MAX_PLAYERS - 1),
  tick: z.number().int().min(0),
  source: z.enum(['keyboard', 'pointer', 'touch', 'gamepad', 'network']),
  /** Release pending input when the host changes or hides a control set. */
  cancelPending: z.boolean().optional(),
  actions: z
    .record(z.string().min(1).max(32), actionValueSchema)
    .refine((actions) => Object.keys(actions).length <= MAX_ACTIONS_PER_FRAME, {
      message: `at most ${MAX_ACTIONS_PER_FRAME} actions per frame`,
    }),
});
export type ActionFrame = z.infer<typeof actionFrameSchema>;

export const viewIdSchema = z.enum(['iso', 'topdown', 'side', 'follow', 'fps', 'orbit', 'fixed']);
export type ViewId = z.infer<typeof viewIdSchema>;

/** Data half of a rig, so a manifest can declare overrides later. */
export const rigInputMappingSchema = z.looseObject({
  keyboard: z.record(z.string(), z.string()),
  touch: z.enum(['stick', 'two-stick', 'tap']),
  gamepad: z.record(z.string(), z.string()),
  pointerLock: z.boolean(),
  pointer: z.object({ buttons: z.record(z.string(), z.string()) }).optional(),
});
export type RigInputMapping = z.infer<typeof rigInputMappingSchema>;

/**
 * Named host control set for the current screen or context. `none` hides controls and `gameplay` is the default.
 */
export const controlsLayoutSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u);
export type ControlsLayout = z.infer<typeof controlsLayoutSchema>;

/** The shared icons the host touch overlay draws on its buttons; a manifest maps button actions to them. */
export const touchIconSchema = z.enum([
  'attack',
  'talk',
  'run',
  'heavy-attack',
  'block',
  'roll',
  'use',
  'cast',
  'potion',
  'map',
  'inventory',
  'jump',
  'confirm',
  'back',
  'rotate-cw',
  'rotate-ccw',
  'down',
  'hard-drop',
  'left',
  'right',
  'swap',
  'pause',
  'action',
]);
export type TouchIcon = z.infer<typeof touchIconSchema>;

/** A named set describes the controls the host presents on one game screen or context. */
export const controlSetSchema = z.strictObject({
  layout: z.enum(['stick', 'two-stick', 'dpad', 'tap']),
  stick: z.string().min(1).max(32).optional(),
  secondStick: z.string().min(1).max(32).optional(),
  buttons: z
    .array(
      z.strictObject({
        action: z.string().min(1).max(32),
        icon: touchIconSchema,
        label: z.string().min(1).max(80),
        behavior: z.enum(['tap', 'hold']),
      }),
    )
    .max(5),
});
export type ControlSet = z.infer<typeof controlSetSchema>;

/** One instance per local player; implemented by OGM-025. */
export interface CameraRig {
  id: ViewId;
  dimension: '2d' | '3d';
  attach(target: { position(): Vec3 }, playerIndex: number): void;
  update(dt: number, frame: ActionFrame): void;
  occlusion: 'none' | 'cutaway' | 'fade' | 'collide';
  inputMapping: RigInputMapping;
  worldToScreen(p: Vec3): { x: number; y: number } | null;
}

export const inputSchemas = {
  'input.v1': actionFrameSchema,
} satisfies Record<'input.v1', z.ZodType>;
