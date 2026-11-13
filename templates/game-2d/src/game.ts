import type { ActionFrame, GameInstance, GameModule, Patch, SaveData } from '@ogm/contracts';
import type { AssetLoader } from '@gm/sdk/assets';
import { z } from 'zod';

import { manifest } from './manifest.js';
import {
  addPlayer,
  applyInput,
  createSimulation,
  GROUND_Y,
  platformsFromDesign,
  restoreSimulation,
  serializeSimulation,
  stepSimulation,
  type SerializedSimulation,
  type SimulationState,
} from './state.js';

const entitySchema = z.object({
  id: z.string(),
  prefab: z.enum(['spawn', 'platform']),
  level: z.string(),
  origin: z.string(),
  props: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      pose: z.looseObject({ position: z.tuple([z.number(), z.number(), z.number()]) }).optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
    })
    .refine((props) => props.pose !== undefined || (props.x !== undefined && props.y !== undefined)),
});

const sceneryEntitySchema = z.looseObject({
  id: z.string(),
  prefab: z.templateLiteral(['scenery:', z.string()]),
  level: z.string(),
  origin: z.enum(['build', 'creator']),
  props: z.looseObject({
    x: z.number().optional(),
    y: z.number().optional(),
    pose: z.looseObject({ position: z.tuple([z.number(), z.number(), z.number()]) }).optional(),
  }),
});

export const designSchema = z.object({
  schemaVersion: z.number().int().positive().default(1),
  globals: z
    .looseObject({
      'player.speed': z.number().min(60).max(400).default(160),
      'level.width': z.number().int().min(640).max(4096).default(1280),
    })
    .default({ 'player.speed': 160, 'level.width': 1280 }),
  entities: z.record(z.string(), z.union([entitySchema, sceneryEntitySchema])).default({
    spawn_01K8ZTEMP00000000000000001: {
      id: 'spawn_01K8ZTEMP00000000000000001',
      prefab: 'spawn',
      level: 'main',
      origin: 'build',
      props: { x: 96, y: 400 },
    },
    spawn_01K8ZTEMP00000000000000002: {
      id: 'spawn_01K8ZTEMP00000000000000002',
      prefab: 'spawn',
      level: 'main',
      origin: 'build',
      props: { x: 192, y: 400 },
    },
    platform_01K8ZTEMP00000000000000003: {
      id: 'platform_01K8ZTEMP00000000000000003',
      prefab: 'platform',
      level: 'main',
      origin: 'build',
      props: { x: 400, y: 320, w: 200 },
    },
  }),
});

export type PlatformDesign = z.infer<typeof designSchema>;
export type PlatformSave = SerializedSimulation;

export const defaultDesign: PlatformDesign = designSchema.parse({});

export interface TemplateContext {
  design: PlatformDesign;
  state: SimulationState;
  paused: boolean;
  disposed: boolean;
  lifecycle?: {
    pause(): void;
    resume(): void;
    dispose(): void;
    restartScene(data?: unknown): void;
  };
  view?: {
    screenToWorld(nx: number, ny: number): [number, number];
    worldToScreen(point: [number, number, number]): { x: number; y: number } | null;
  };
  /** Bridge `editor.camera`; applied by the level scene while `editing()`. */
  camera: { mode: 'follow' | 'free'; target?: string };
  editing?: () => boolean;
  sceneryAssets?: AssetLoader;
  updateScenery?: () => void;
  pickScenery?: (x: number, y: number) => string[];
  sceneryScreen?: (position: [number, number, number], parallax: number) => { x: number; y: number } | null;
  advance(dt: number, frames: ActionFrame[]): void;
}

let activeContext: TemplateContext | undefined;

export function getGameContext(): TemplateContext {
  if (!activeContext) throw new Error('game context is not mounted');
  return activeContext;
}

export function connectPhaserLifecycle(lifecycle: TemplateContext['lifecycle']): void {
  getGameContext().lifecycle = lifecycle;
}

function hitsPlatform(
  platforms: SimulationState['platforms'],
  x: number,
  y: number,
  width = 160,
  height = 24,
): boolean {
  return platforms.some(
    (platform) =>
      Math.abs(x - platform.x) < (width + platform.width) / 2 &&
      Math.abs(y - platform.y) < (height + platform.height) / 2,
  );
}

function playerById(state: SimulationState, id: string) {
  for (const player of state.players.values()) {
    if (player.id === id) return player;
  }
  return undefined;
}

/** A player's or platform's world position, for the follow camera. */
export function entityPosition(state: SimulationState, id: string): [number, number, number] | undefined {
  const player = playerById(state, id);
  if (player) return [player.pos.x, player.pos.y, 0];
  const platform = state.platforms.find((candidate) => candidate.id === id);
  return platform ? [platform.x, platform.y, 0] : undefined;
}

/**
 * What the level camera shows now: edit mode obeys `editor.camera`, play mode always follows player 0.
 * A followed target that is removed later falls back to player 0.
 * `key` changes only when the camera must be re-applied; `undefined` while there is nothing to follow.
 */
export function cameraView(
  context: TemplateContext,
): { key: string; mode: 'free' } | { key: string; mode: 'follow'; position(): [number, number, number] } | undefined {
  const editing = context.editing?.() ?? false;
  const mode = editing ? context.camera.mode : 'follow';
  const target = editing ? context.camera.target : undefined;
  const key = `${mode}:${target ?? ''}`;
  if (mode === 'free') return { key, mode };
  if (target === undefined && !context.state.players.has(0)) return undefined;
  return {
    key,
    mode,
    position: () => {
      const state = getGameContext().state;
      const followed = target === undefined ? undefined : entityPosition(state, target);
      if (followed) return followed;
      const player = state.players.get(0);
      return player ? [player.pos.x, player.pos.y, 0] : [0, 0, 0];
    },
  };
}

export const game: GameModule<PlatformDesign, PlatformSave> = {
  manifest,
  designSchema,
  controls: [
    {
      id: 'player.speed',
      label: 'Player speed',
      scope: 'global',
      path: '/globals/player.speed',
      widget: { kind: 'slider', min: 60, max: 400, step: 10, unit: 'px/s' },
      default: 160,
    },
    {
      id: 'level.width',
      label: 'Level width',
      scope: 'global',
      path: '/globals/level.width',
      widget: { kind: 'count', min: 640, max: 4096, semantics: 'param' },
      default: 1280,
    },
  ],
  async mount(_host, initialDesign, save): Promise<GameInstance<PlatformDesign, PlatformSave>> {
    const context: TemplateContext = {
      design: structuredClone(initialDesign),
      state: save ? restoreSimulation(initialDesign, save.data) : createSimulation(initialDesign),
      paused: false,
      disposed: false,
      camera: { mode: 'follow' },
      advance(dt, frames) {
        if (context.paused || context.disposed) return;
        for (const frame of frames) applyInput(context.state, frame);
        stepSimulation(context.state, context.design, dt);
      },
    };
    activeContext = context;

    return {
      pause() {
        context.paused = true;
        context.lifecycle?.pause();
      },
      resume() {
        context.paused = false;
        context.lifecycle?.resume();
      },
      dispose() {
        if (context.disposed) return;
        context.disposed = true;
        context.lifecycle?.dispose();
        if (activeContext === context) activeContext = undefined;
      },
      applyDesign(next: PlatformDesign, patches: Patch[]) {
        context.design = structuredClone(next);
        context.state.platforms = platformsFromDesign(next);
        context.updateScenery?.();
        const restart = patches.some(
          ({ path }) => path[0] === 'entities' || (path[0] === 'globals' && path[1] === 'level.width'),
        );
        if (restart) context.lifecycle?.restartScene({ width: next.globals['level.width'] });
        return restart ? 'restart-scene' : 'live';
      },
      serialize(): SaveData<PlatformSave> {
        return { saveSchemaVersion: 1, data: serializeSimulation(context.state) };
      },
      restore(saved) {
        context.state = restoreSimulation(context.design, saved.data);
      },
      migrate(previous) {
        const data = previous.data as Partial<SerializedSimulation>;
        return {
          saveSchemaVersion: 1,
          data: {
            tick: Number.isInteger(data.tick) && Number(data.tick) >= 0 ? Number(data.tick) : 0,
            players: Array.isArray(data.players) ? structuredClone(data.players) : [],
          },
        };
      },
      pick(nx, ny) {
        const [x, y] = context.view?.screenToWorld(nx, ny) ?? [
          nx * game.manifest.presentation.minLogical.w,
          ny * game.manifest.presentation.minLogical.h,
        ];
        const targets = [];
        for (const player of context.state.players.values()) {
          if (Math.abs(x - player.pos.x) <= 14 && y >= player.pos.y && y <= player.pos.y + 40) {
            targets.push({ id: player.id, kind: 'entity' as const });
          }
        }
        for (const platform of context.state.platforms) {
          if (Math.abs(x - platform.x) <= platform.width / 2 && y >= platform.y && y <= platform.y + platform.height) {
            targets.push({ id: platform.id, kind: 'entity' as const });
          }
        }
        for (const itemId of context.pickScenery?.(x, y) ?? []) {
          const entity = Object.values(context.design.entities).find(
            (entry) =>
              entry.prefab.startsWith('scenery:') &&
              ((entry.props as Record<string, unknown>).sceneryItemId ?? entry.id) === itemId,
          );
          if (entity) targets.push({ id: entity.id, kind: 'entity' as const });
        }
        return targets;
      },
      screenToWorld(nx, ny) {
        const [x, y] = context.view?.screenToWorld(nx, ny) ?? [
          nx * game.manifest.presentation.minLogical.w,
          ny * game.manifest.presentation.minLogical.h,
        ];
        return [x, y, 0];
      },
      worldToScreen(id) {
        const entity = context.design.entities[id];
        if (entity?.prefab.startsWith('scenery:')) {
          const pose = (entity.props as Record<string, unknown>).pose as
            { position?: [number, number, number] } | undefined;
          const parallax = (entity.props as Record<string, unknown>)['scenery.parallax'];
          return pose?.position
            ? (context.sceneryScreen?.(pose.position, typeof parallax === 'number' ? parallax : 1) ?? null)
            : null;
        }
        const player = playerById(context.state, id);
        if (player) {
          return (
            context.view?.worldToScreen([player.pos.x, player.pos.y, 0]) ?? {
              x: player.pos.x,
              y: player.pos.y,
            }
          );
        }
        const platform = context.state.platforms.find((candidate) => candidate.id === id);
        if (!platform) return null;
        return context.view?.worldToScreen([platform.x, platform.y, 0]) ?? { x: platform.x, y: platform.y };
      },
      setCamera(mode, target) {
        if (target !== undefined && !entityPosition(context.state, target)) {
          throw new Error(`unknown camera target ${target}`);
        }
        context.camera = { mode, target };
      },
      validatePlacement(prefab, pose) {
        if (prefab.startsWith('scenery:')) {
          try {
            context.sceneryAssets?.resolve(prefab.slice('scenery:'.length));
            return context.sceneryAssets ? { ok: true } : { ok: false, reason: 'asset unavailable' };
          } catch {
            return { ok: false, reason: 'asset unavailable' };
          }
        }
        if (prefab !== 'platform') return { ok: false, reason: 'unknown prefab' };
        const [x, y] = pose.position;
        if (x < 80 || x > context.design.globals['level.width'] - 80 || y < 0 || y > GROUND_Y - 24) {
          return { ok: false, reason: 'outside level bounds' };
        }
        if (hitsPlatform(context.state.platforms, x, y)) {
          return { ok: false, reason: 'overlaps an existing platform' };
        }
        return { ok: true };
      },
      net: {
        spawn(playerIndex, playerId) {
          addPlayer(context.state, context.design, playerIndex, playerId);
        },
        despawn(playerId) {
          const player = playerById(context.state, playerId);
          if (!player) return;
          context.state.players.delete(player.playerIndex);
          context.state.inputs.delete(player.playerIndex);
        },
        snapshot() {
          return { tick: context.state.tick, state: serializeSimulation(context.state) };
        },
        applySnapshot(snapshot) {
          context.state = restoreSimulation(context.design, snapshot.state as SerializedSimulation);
        },
        hud(playerIndex) {
          const player = context.state.players.get(playerIndex);
          return { onGround: player?.onGround ?? false, x: player?.pos.x ?? 0, tick: context.state.tick };
        },
      },
    };
  },
};
