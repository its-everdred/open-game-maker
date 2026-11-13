import { createPhysics, type PhysicsHandle } from '@gm/sdk/three';
import type { ActionValue, GameInstance, GameModule, HostApi, Patch, SaveData, TargetRef, Vec3 } from '@ogm/contracts';
import { z } from 'zod';

import type { Runtime } from '@gm/sdk/core';

import { manifest, scenerySettingsControl } from './manifest.js';

export interface SpawnEntity {
  id: string;
  prefab: 'spawn';
  level: string;
  origin: 'build' | 'creator';
  props: { x?: number; z?: number; pose?: { position: Vec3; rotationY?: number } };
}

export interface LevelDesign {
  schemaVersion: 1;
  globals: { 'player.speed': number; 'level.size': number };
  entities: Record<string, SpawnEntity | SceneryEntity>;
}

export interface SceneryEntity {
  id: string;
  prefab: `scenery:${string}`;
  level: string;
  origin: 'build' | 'creator';
  props: Record<string, unknown>;
}

export interface PlayerState {
  id: string;
  playerIndex: number;
  position: Vec3;
  velocity: Vec3;
}

export interface GameSave {
  tick: number;
  players: Record<string, PlayerState>;
  physics?: number[];
}

export interface SceneAdapter {
  pick(nx: number, ny: number): TargetRef[];
  screenToWorld(nx: number, ny: number, selected?: string, prefab?: string): Vec3 | null;
  worldToScreen(id: string): { x: number; y: number } | null;
}

export const DEFAULT_DESIGN: LevelDesign = {
  schemaVersion: 1,
  globals: { 'player.speed': 4, 'level.size': 12 },
  entities: {
    spawn_01K8ZTEMP00000000000000001: {
      id: 'spawn_01K8ZTEMP00000000000000001',
      prefab: 'spawn',
      level: 'main',
      origin: 'build',
      props: { x: -3, z: 0 },
    },
    spawn_01K8ZTEMP00000000000000002: {
      id: 'spawn_01K8ZTEMP00000000000000002',
      prefab: 'spawn',
      level: 'main',
      origin: 'build',
      props: { x: 3, z: 0 },
    },
  },
};

const FIXED_DT = 1 / 60;
const GRAVITY = -9.81;
const PLAYER_GROUND_Y = 1;

export const levelDesignSchema: z.ZodType<LevelDesign> = z.object({
  schemaVersion: z.literal(1).default(1),
  globals: z
    .looseObject({
      'player.speed': z.number().min(1).max(10).default(4),
      'level.size': z.number().min(6).max(40).default(12),
    })
    .default({ 'player.speed': 4, 'level.size': 12 }),
  entities: z
    .record(
      z.string(),
      z.union([
        z.object({
          id: z.string(),
          prefab: z.literal('spawn'),
          level: z.string().min(1),
          origin: z.enum(['build', 'creator']),
          props: z
            .object({
              x: z.number().optional(),
              z: z.number().optional(),
              pose: z
                .object({ position: z.tuple([z.number(), z.number(), z.number()]), rotationY: z.number().optional() })
                .optional(),
            })
            .refine((props) => props.pose !== undefined || (props.x !== undefined && props.z !== undefined)),
        }),
        z.object({
          id: z.string(),
          prefab: z.templateLiteral(['scenery:', z.string()]),
          level: z.string().min(1),
          origin: z.enum(['build', 'creator']),
          props: z.record(z.string(), z.unknown()),
        }),
      ]),
    )
    .default(() => structuredClone(DEFAULT_DESIGN.entities)),
});

function spawnEntries(design: LevelDesign): SpawnEntity[] {
  return Object.values(design.entities)
    .filter((entity): entity is SpawnEntity => entity.prefab === 'spawn')
    .sort((left, right) => left.id.localeCompare(right.id));
}

function spawnPlayer(design: LevelDesign, playerIndex: number, playerId: string): PlayerState {
  const spawns = spawnEntries(design);
  const spawn = spawns[playerIndex % Math.max(1, spawns.length)];
  const position: Vec3 = spawn ? spawnPosition(spawn) : [0, 0, 0];
  return {
    id: playerId,
    playerIndex,
    position: [position[0], 1, position[2]],
    velocity: [0, 0, 0],
  };
}

function spawnPosition(spawn: SpawnEntity): Vec3 {
  return spawn.props.pose?.position ?? [spawn.props.x ?? 0, 0, spawn.props.z ?? 0];
}

function cloneSave(state: GameSave): GameSave {
  return structuredClone(state);
}

export function createGame(): {
  module: GameModule<LevelDesign, GameSave>;
  state(): GameSave;
  design(): LevelDesign;
  attachPhysics(runtime: Runtime<LevelDesign, GameSave>): Promise<PhysicsHandle>;
  attachScene(adapter: SceneAdapter): void;
  onDesignChange(listener: (design: LevelDesign) => void): () => void;
  setSceneryAssetValidator(validate: (id: string) => boolean): void;
  setSceneryImageValidator(validate: (id: string) => boolean): void;
  /** The last bridge `editor.camera`; `undefined` keeps the manifest rig. */
  camera(): { mode: 'follow' | 'free'; target?: string } | undefined;
  /** A player's or spawn's world position; the default player when `id` is absent. */
  position(id?: string): Vec3 | undefined;
  /** Where `editor.camera` follow looks: `target`, else the default player once it is gone, else the origin. */
  followPosition(target?: string): Vec3;
} {
  let design = structuredClone(DEFAULT_DESIGN);
  const designListeners = new Set<(next: LevelDesign) => void>();
  let validSceneryAsset: (id: string) => boolean = () => false;
  let isSceneryImage: (id: string) => boolean = () => false;
  let state: GameSave = { tick: 0, players: {} };
  let physics: PhysicsHandle | undefined;
  let initialPhysics: Uint8Array | undefined;
  let stopPhysicsSync: (() => void) | undefined;
  let scene: SceneAdapter | undefined;
  let selectedId: string | undefined;
  const bodyHandles = new Map<string, number>();
  const stopInputs: (() => void)[] = [];
  let camera: { mode: 'follow' | 'free'; target?: string } | undefined;

  const position = (id = 'player_0'): Vec3 | undefined => {
    const player = state.players[id];
    if (player) return [...player.position];
    const spawn = design.entities[id];
    return spawn?.prefab === 'spawn' ? [...spawnPosition(spawn)] : undefined;
  };

  const addPlayerBody = (player: PlayerState) => {
    if (!physics || bodyHandles.has(player.id)) return;
    const [x, y, z] = player.position;
    const body = physics.world.createRigidBody(
      physics.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    physics.world.createCollider(physics.rapier.ColliderDesc.capsule(0.5, 0.4), body);
    bodyHandles.set(player.id, body.handle);
  };

  const stepPhysics = () => {
    if (!physics) return;
    for (const player of Object.values(state.players)) {
      if (player.position[1] > PLAYER_GROUND_Y || player.velocity[1] > 0) {
        const verticalVelocity = player.velocity[1] + GRAVITY * FIXED_DT;
        const y = Math.max(PLAYER_GROUND_Y, player.position[1] + verticalVelocity * FIXED_DT);
        player.position = [player.position[0], y, player.position[2]];
        player.velocity = [player.velocity[0], y === PLAYER_GROUND_Y ? 0 : verticalVelocity, player.velocity[2]];
      }
      addPlayerBody(player);
      const handle = bodyHandles.get(player.id);
      const body = handle === undefined ? null : physics.world.getRigidBody(handle);
      if (!body) continue;
      const [x, y, z] = player.position;
      body.setNextKinematicTranslation({ x, y, z });
    }
  };

  const module: GameModule<LevelDesign, GameSave> = {
    manifest,
    designSchema: levelDesignSchema,
    controls: [
      scenerySettingsControl,
      {
        id: 'player.speed',
        label: 'Player speed',
        scope: 'global',
        path: '/globals/player.speed',
        widget: { kind: 'slider', min: 1, max: 10, step: 0.5 },
        default: 4,
      },
      {
        id: 'level.size',
        label: 'Level size',
        scope: 'global',
        path: '/globals/level.size',
        widget: { kind: 'count', min: 6, max: 40, semantics: 'param' },
        default: 12,
      },
    ],
    async mount(host: HostApi, initialDesign: LevelDesign, save?: SaveData<GameSave>) {
      design = structuredClone(initialDesign);
      state = save?.data
        ? cloneSave(save.data)
        : { tick: 0, players: { player_0: spawnPlayer(design, 0, 'player_0') } };

      stopInputs.push(
        host.input.on('move', (value: ActionValue) => {
          if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) return;
          const player = state.players.player_0;
          if (!player) return;
          const speed = design.globals['player.speed'];
          const half = design.globals['level.size'] / 2 - 0.5;
          const vx = value.x * speed;
          const vz = value.y * speed;
          player.velocity = [vx, player.velocity[1], vz];
          player.position = [
            Math.max(-half, Math.min(half, player.position[0] + vx * FIXED_DT)),
            player.position[1],
            Math.max(-half, Math.min(half, player.position[2] + vz * FIXED_DT)),
          ];
          state.tick += 1;
        }),
        host.input.on('jump', (value: ActionValue) => {
          const player = state.players.player_0;
          if (value !== true || !player || player.position[1] > PLAYER_GROUND_Y) return;
          player.velocity = [player.velocity[0], 5, player.velocity[2]];
        }),
      );

      const instance: GameInstance<LevelDesign, GameSave> = {
        pause() {},
        resume() {},
        dispose() {
          for (const stop of stopInputs.splice(0)) stop();
          stopPhysicsSync?.();
          stopPhysicsSync = undefined;
          physics?.dispose();
          physics = undefined;
          initialPhysics = undefined;
          bodyHandles.clear();
        },
        applyDesign(next: LevelDesign, patches: Patch[]) {
          design = structuredClone(next);
          for (const listener of designListeners) listener(structuredClone(design));
          return patches.some(({ path }) => path[0] === 'globals' && path[1] === 'level.size')
            ? 'restart-scene'
            : 'live';
        },
        serialize() {
          const saved = cloneSave(state);
          if (physics) saved.physics = Array.from(physics.snapshot());
          return { saveSchemaVersion: 1, data: saved };
        },
        restore(saved: SaveData<GameSave>) {
          const restored = cloneSave(saved.data);
          const physicsSnapshot = restored.physics ? Uint8Array.from(restored.physics) : initialPhysics;
          delete restored.physics;
          state = restored;
          if (physics && physicsSnapshot) physics.restore(physicsSnapshot);
        },
        migrate(previous: SaveData<unknown>) {
          const value = previous.data as Partial<GameSave>;
          return {
            saveSchemaVersion: 1,
            data: {
              tick: typeof value.tick === 'number' ? value.tick : 0,
              players: value.players ? structuredClone(value.players) : {},
            },
          };
        },
        pick(nx, ny) {
          return scene?.pick(nx, ny) ?? [];
        },
        screenToWorld(nx, ny, prefab) {
          return scene?.screenToWorld(nx, ny, selectedId, prefab) ?? null;
        },
        worldToScreen(id) {
          return scene?.worldToScreen(id) ?? null;
        },
        setSelection(ids) {
          selectedId = ids[0];
        },
        setCamera(mode, target) {
          if (target !== undefined && !position(target)) throw new Error(`unknown camera target ${target}`);
          camera = { mode, target };
        },
        validatePlacement(prefab, pose) {
          const half = design.globals['level.size'] / 2;
          const [x, , z] = pose.position;
          if (prefab.startsWith('scenery:')) {
            if (!validSceneryAsset(prefab.slice('scenery:'.length))) return { ok: false, reason: 'asset unavailable' };
            if (
              'scenery.backdrop' in design.globals &&
              design.globals['scenery.backdrop'] &&
              isSceneryImage(prefab.slice('scenery:'.length))
            )
              return { ok: true };
            return Math.abs(x) >= half || Math.abs(z) >= half
              ? { ok: true }
              : { ok: false, reason: 'inside play area' };
          }
          return Math.abs(x) <= half && Math.abs(z) <= half
            ? { ok: true }
            : { ok: false, reason: 'outside level bounds' };
        },
        net: {
          spawn(playerIndex, playerId) {
            state.players[playerId] ??= spawnPlayer(design, playerIndex, playerId);
            addPlayerBody(state.players[playerId]);
          },
          despawn(playerId) {
            delete state.players[playerId];
            const handle = bodyHandles.get(playerId);
            const body = handle === undefined || !physics ? null : physics.world.getRigidBody(handle);
            if (body && physics) physics.world.removeRigidBody(body);
            bodyHandles.delete(playerId);
          },
          snapshot() {
            return { tick: state.tick, state: cloneSave(state) };
          },
          applySnapshot(snapshot) {
            state = cloneSave(snapshot.state as GameSave);
          },
          hud(playerIndex) {
            const player = Object.values(state.players).find((candidate) => candidate.playerIndex === playerIndex);
            return { speed: design.globals['player.speed'], player: player?.id ?? '' };
          },
        },
      };
      return instance;
    },
  };

  return {
    module,
    state: () => cloneSave(state),
    design: () => structuredClone(design),
    setSceneryAssetValidator(validate) {
      validSceneryAsset = validate;
    },
    setSceneryImageValidator(validate) {
      isSceneryImage = validate;
    },
    onDesignChange(listener) {
      designListeners.add(listener);
      return () => {
        designListeners.delete(listener);
      };
    },
    async attachPhysics(runtime) {
      stopPhysicsSync?.();
      stopPhysicsSync = runtime.onStep(stepPhysics);
      physics = await createPhysics(runtime as Runtime<unknown, unknown>);
      const size = design.globals['level.size'];
      const floor = physics.world.createRigidBody(physics.rapier.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
      physics.world.createCollider(physics.rapier.ColliderDesc.cuboid(size / 2, 0.1, size / 2), floor);
      for (const player of Object.values(state.players)) addPlayerBody(player);
      initialPhysics = physics.snapshot();
      return physics;
    },
    attachScene(adapter) {
      scene = adapter;
    },
    camera: () => (camera ? { ...camera } : undefined),
    position,
    followPosition: (target) => position(target) ?? position() ?? [0, 0, 0],
  };
}
