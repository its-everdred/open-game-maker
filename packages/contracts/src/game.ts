import { z } from 'zod';

import type { Patch } from './bridge.js';
import type { ActionFrame, ActionValue, Insets } from './input.js';
import { vec3Schema, viewIdSchema } from './input.js';
import { netManifestSchema } from './net.js';

/* Manifest strings are rendered as text by consumers (A4 §4 rule 3); caps keep them bounded. */
const title = z.string().min(1).max(80);
const label = z.string().min(1).max(200);
const help = z.string().max(200);

export const poseSchema = z.looseObject({ position: vec3Schema, rotationY: z.number().optional() });
export type Pose = z.infer<typeof poseSchema>;

export const targetRefSchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(['entity', 'control', 'tile']),
  bounds: z.looseObject({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});
export type TargetRef = z.infer<typeof targetRefSchema>;

export const hudModelSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type HudModel = z.infer<typeof hudModelSchema>;

export const selectorSchema = z.looseObject({
  tag: z.string().optional(),
  prefab: z.string().optional(),
  ids: z.array(z.string()).optional(),
  where: z.record(z.string(), z.unknown()).optional(),
});
export type Selector = z.infer<typeof selectorSchema>;

export type Widget =
  | { kind: 'slider'; min: number; max: number; step?: number; unit?: string }
  | { kind: 'toggle' }
  | { kind: 'choice'; options: { value: string; label: string; icon?: string }[] }
  | { kind: 'color'; palette?: string[] }
  | { kind: 'count'; min: number; max: number; semantics: 'param' | 'instances' }
  | { kind: 'text'; maxLength: number }
  | { kind: 'place'; prefab: string }
  | { kind: 'path' }
  | { kind: 'tilemap'; tileset: string }
  | { kind: 'rule'; template: string; slots: Record<string, Widget> }
  | { kind: 'custom'; renderer: 'game-overlay'; id: string };

/** A4 §6 widget vocabulary plus B7 §3 `count.semantics`. */
export const widgetSchema: z.ZodType<Widget> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.looseObject({
      kind: z.literal('slider'),
      min: z.number(),
      max: z.number(),
      step: z.number().positive().optional(),
      unit: z.string().max(16).optional(),
    }),
    z.looseObject({ kind: z.literal('toggle') }),
    z.looseObject({
      kind: z.literal('choice'),
      options: z.array(z.looseObject({ value: z.string(), label, icon: z.string().max(200).optional() })).min(1),
    }),
    z.looseObject({ kind: z.literal('color'), palette: z.array(z.string()).optional() }),
    z.looseObject({
      kind: z.literal('count'),
      min: z.number().int(),
      max: z.number().int(),
      semantics: z.enum(['param', 'instances']),
    }),
    z.looseObject({ kind: z.literal('text'), maxLength: z.number().int().positive() }),
    z.looseObject({ kind: z.literal('place'), prefab: z.string().min(1) }),
    z.looseObject({ kind: z.literal('path') }),
    z.looseObject({ kind: z.literal('tilemap'), tileset: z.string().min(1) }),
    z.looseObject({
      kind: z.literal('rule'),
      template: z.string().max(200),
      slots: z.record(z.string(), widgetSchema),
    }),
    z.looseObject({ kind: z.literal('custom'), renderer: z.literal('game-overlay'), id: z.string().min(1) }),
  ]),
);

/** Stable forever, dotted lowercase: `enemy.color`. */
export const CONTROL_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

/** A4 §6 control, with B7 §3 scopes and without `aliases` (B7 §2 dropped NL synonyms). */
export const controlDeclSchema = z.looseObject({
  id: z.string().max(64).regex(CONTROL_ID_PATTERN),
  label,
  icon: z.string().max(200).optional(),
  help: help.optional(),
  group: z.string().max(200).optional(),
  scope: z.union([z.enum(['global', 'instance', 'prefab']), z.looseObject({ selector: selectorSchema })]),
  /** JSON pointer into the design doc, relative to each target. */
  path: z.string().regex(/^(\/([^~/]|~[01])*)+$/),
  widget: widgetSchema,
  default: z.unknown(),
  tier: z.enum(['basic', 'advanced']).optional(),
});
export type ControlDecl = z.infer<typeof controlDeclSchema>;

/** A4 §6 `core.manifest` fields plus the B7 §3 minimum additions. */
export const gameManifestSchema = z.looseObject({
  id: z.string().min(1).max(64),
  /** Semver range of the SDK the game targets. */
  sdk: z.string().min(1).max(64),
  title,
  /** Optional build-time pin for the one HTTP(S) host origin allowed to frame this game. */
  hostOrigin: z
    .string()
    .regex(/^https?:\/\/[^/?#@]+$/u)
    .url()
    .optional(),
  inputs: z.looseObject({ actions: z.record(z.string().min(1).max(32), z.enum(['button', 'axis', 'stick'])) }),
  presentation: z.looseObject({
    orientation: z.enum(['landscape', 'portrait', 'any']),
    minLogical: z.looseObject({ w: z.number().positive(), h: z.number().positive() }),
    fit: z.enum(['responsive', 'fixed']),
  }),
  view: viewIdSchema,
  dimension: z.enum(['2d', '3d']),
  capabilities: z.array(z.string()),
  palette: z.looseObject({
    categories: z.array(z.looseObject({ id: z.string().min(1), label, kind: z.enum(['items', 'tools', 'panel']) })),
    items: z.array(
      z.looseObject({
        prefab: z.string().min(1),
        label,
        thumbnail: z.string().optional(),
        /** Short creator-facing descriptor, such as "easy" or "tough". */
        tag: z.string().min(1).max(32).optional(),
        aiGenerated: z.boolean().optional(),
        hint: help.optional(),
        category: z.string().min(1),
      }),
    ),
  }),
  tools: z.array(z.enum(['select', 'place', 'brush', 'sculpt', 'erase', 'path'])),
  gizmos: z.record(z.string(), z.array(z.enum(['translate', 'rotateYaw', 'elevate', 'splinePoints']))),
  grid: z.looseObject({ size: z.number().positive(), units: z.string().max(16) }).optional(),
  playLabel: z.string().min(1).max(80).optional(),
  /** Appearance of the shell menu button while playing this game. */
  playMenuButton: z
    .looseObject({ colour: z.string().regex(/^#[0-9a-fA-F]{6}$/u), icon: z.enum(['pause', 'menu']) })
    .optional(),
  saves: z.boolean(),
  /**
   * The save schema version this build writes and, when the game migrates, the one older version it still reads.
   * The SDK fills both from the mounted instance in its `ready` handshake, so a build's `manifest.json` need not
   * declare them; the host reads them to judge stored slots before it offers Load.
   */
  saveSchema: z.number().int().nonnegative().optional(),
  migratesFrom: z.number().int().nonnegative().optional(),
  /** Netcode v2 (`net.ts`). Absent means host authority, which is every build written before v2. */
  net: netManifestSchema.optional(),
  overrides: z.looseObject({
    aliases: z.record(z.string(), z.string()),
    retired: z.array(z.string()),
    migrate: z.array(z.string()).optional(),
  }),
});
export type GameManifest = z.infer<typeof gameManifestSchema>;

export type SaveData<S> = { saveSchemaVersion: number; data: S };
export type PlacementResult = { ok: true } | { ok: false; reason: string };

export interface GameModule<D, S> {
  manifest: GameManifest;
  designSchema: z.ZodType<D>;
  controls: ControlDecl[];
  mount(host: HostApi, design: D, save?: SaveData<S>): Promise<GameInstance<D, S>>;
  /** Maps a stored override after a control changed; `'drop'` discards it. */
  migrateOverride?(controlId: string, value: unknown): unknown | 'drop';
}

export interface GameInstance<D, S> {
  pause(): void;
  resume(): void;
  dispose(): void;
  /** Deterministic given `next` (E04-15). */
  applyDesign(next: D, patches: Patch[]): 'live' | 'restart-scene';
  /** Also the `renderGameToText` source (A9 §3.1). */
  serialize(): SaveData<S>;
  restore(save: SaveData<S>): void;
  migrate?(prev: SaveData<unknown>): SaveData<S>;
  pick?(nx: number, ny: number): TargetRef[];
  worldToScreen?(id: string): { x: number; y: number } | null;
  validatePlacement?(prefab: string, pose: Pose): PlacementResult;
  setSelection?(ids: string[]): void;
  /** Bridge `editor.camera`; throws for an unknown `target`. */
  setCamera?(mode: 'follow' | 'free', target?: string): void;
  /** Required by every template (E04-15). */
  net: MultiplayerHooks;
}

/**
 * D-HOOKS test surface: the bridge `test.*` messages, and window globals in draft and test builds
 * only: `window.__gm` (this object), `window.render_game_to_text`, `window.advanceTime`, plus the
 * aliases `window.__gm.tick(seconds)`, `window.__frame(t)`, `window.__ready`, `window.__marks`.
 * T10 names map as `act` → `inject`, `tap` → `hitTest`, `reseed` → `setSeed`, `frame(t)` → `renderAt`.
 */
export interface GmTestHooks {
  ready: boolean;
  marks: [string, number][];
  /** Fixed 1/60 s steps, no render until the last step. */
  advanceTime(ms: number): void;
  /** Keyframe + advanceTime to absolute time, one render. */
  renderAt(ms: number): void;
  renderGameToText(): { coords: string; tick: number; mode: 'play' | 'edit'; state: unknown; players: unknown[] };
  /** `calls` is the draw calls of the most recently rendered frame, not a since-boot total (#272). */
  renderInfo(): { calls: number; triangles: number; frameMs: number; textureBytes: number; backend: string };
  hitTest(nx: number, ny: number): boolean;
  setSeed(seed: number): void;
  inject(frame: ActionFrame): void;
  probes(): Record<string, number | string | boolean>;
  events(since: number): { t: number; type: string; data?: unknown }[];
  seed(): number;
}

export interface MultiplayerHooks {
  /** Host-minted ids, spawn points. */
  spawn(playerIndex: number, playerId: string): void;
  despawn(playerId: string): void;
  /** Host client, 20 Hz. */
  snapshot(): { tick: number; state: unknown };
  /** Peers; the SDK interpolates between two snapshots. */
  applySnapshot(s: { tick: number; state: unknown }): void;
  /** Per-player HUD; private fields never included. */
  hud(playerIndex: number): HudModel;
}

/** A state slice with the tick it was captured at. */
export type Snapshot = { tick: number; state: unknown };

/**
 * The per-seat authority hooks (netcode v2). Optional on `GameInstance.net` so every game written against
 * `MultiplayerHooks` still compiles; presence is what a `'per-seat'` manifest is checked against at `boot`.
 *
 * `restore` must apply exactly the slice it is given: the SDK restores three remote seats and the local one
 * independently, so a merge that replaced the whole state would overwrite the local seat.
 */
export interface MultiplayerHooksV2 extends MultiplayerHooks {
  /** `{ seat }` captures that seat's owned state; `{}` captures the shared state. */
  capture?(scope: { seat?: number }): Snapshot;
  restore?(snapshot: Snapshot): void;
  /** A flat, canonically ordered list of integers: seats ascending, then entity ids sorted by code unit. */
  digest?(): readonly number[];
  /**
   * What `seat` may receive from this client on this publish (netcode §5.2.1). Called on the sending side only, once
   * per recipient per publish, and the returned `Snapshot` is encoded as that recipient's `net.state` — so a field
   * this returns less of is a field that recipient never holds. Absent, the client publishes its own owned slice to
   * everyone (`capture({ seat: localSeat })`), which is the no-visibility path byte for byte.
   *
   * Only a `'per-seat'` manifest may implement it: host authority packs one snapshot for every peer and cannot filter.
   * A redacted field is absent from the returned state, never `null` or `0`, and `restore` merges the keys it is given
   * so an absent field keeps the recipient's own reconstruction.
   */
  view?(seat: number): Snapshot;
}

export type Viewport = {
  w: number;
  h: number;
  dpr: number;
  orientation: 'landscape' | 'portrait';
  safe: Insets;
};
export type PlayerSettings = { mute: boolean; volume: number; textScale: number; reduceMotion: boolean };

/** A4 §6 host surface plus test-hook registration. */
export interface HostApi {
  capabilities: ReadonlySet<string>;
  input: { on(action: string, cb: (v: ActionValue) => void): () => void };
  viewport: { onChange(cb: (v: Viewport) => void): () => void; current(): Viewport };
  events: { emit(kind: 'achievement' | 'analytics' | 'checkpoint', payload: unknown): void };
  settings: { onChange(cb: (s: PlayerSettings) => void): () => void };
  test: { register(hooks: GmTestHooks): void };
}

export const gameSchemas = {
  'game.v1': gameManifestSchema,
} satisfies Record<'game.v1', z.ZodType>;
