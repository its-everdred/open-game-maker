import type {
  ActionFrame,
  GameInstance,
  GameManifest,
  GameModule,
  MultiplayerHooksV2,
  NetSeat,
  Patch,
  SaveData,
  Snapshot,
} from '@ogm/contracts';
import { toUnits } from '@gm/sdk/net';
import { z } from 'zod';

import gmManifest from '../gm.manifest.json' with { type: 'json' };
import { hud } from './hud.js';
import {
  addPlayer,
  applyInput,
  applySnapshotState,
  captureOwned,
  captureShared,
  createSimulation,
  digestSimulation,
  GROUND_Y,
  platformsFromDesign,
  playerId,
  removePlayer,
  restoreOwned,
  restoreShared,
  restoreSimulation,
  serializeSimulation,
  stepSimulation,
  type SerializedSimulation,
  type SimulationState,
} from './state.js';

const entitySchema = z.object({
  id: z.string(),
  prefab: z.enum(['platform']),
  level: z.string(),
  origin: z.string(),
  props: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
  }),
});

export const designSchema = z.object({
  schemaVersion: z.number().int().positive().default(1),
  globals: z
    .object({
      'player.speed': z.number().min(60).max(400).default(160),
      'level.width': z.number().int().min(640).max(4096).default(1280),
    })
    .default({ 'player.speed': 160, 'level.width': 1280 }),
  entities: z.record(z.string(), entitySchema).default({
    plat_1: {
      id: 'plat_1',
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
  /** Which player this client is; the HUD and camera follow it. Kept current from `gm.net`. */
  localPlayerIndex: number;
  /**
   * The seat this client's own avatar is in. `createSimulation` seeds the world with one avatar at seat 0 before the
   * seat table arrives; the first table moves that avatar to the seat the room assigned this client.
   */
  ownSeat: number;
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

/**
 * The seat table is the authority on who is playing, so the world follows it: one avatar per occupied seat. The world
 * is built before the first table arrives and is seeded with one avatar at seat 0, so a client the room seated
 * elsewhere keeps that avatar only while another seat holds seat 0; its own avatar is the one the table puts at the
 * seat it holds. Every later table only adds a seat's avatar or removes a forfeited one — an avatar already in the
 * world keeps the position it reached, so a broadcast during a match never resets anybody. A spectator
 * (`localSeat === null`) holds no seat and keeps no avatar of its own.
 */
export function syncSeatTable(seats: readonly NetSeat[], localSeat: number | null): void {
  const context = activeContext;
  if (context === undefined || context.disposed) return;
  /* An empty table is a page that has not heard from the room yet, not a room without players. */
  if (seats.length === 0) return;
  const occupied = seats
    .filter((seat) => seat.userId !== '' && !seat.forfeited && !seat.spectator)
    .map((seat) => seat.seat);

  if (localSeat !== null && localSeat !== context.ownSeat) {
    const placeholder = context.ownSeat;
    context.ownSeat = localSeat;
    context.localPlayerIndex = localSeat;
    /* Seat 0's avatar is this client's own only while no other seat occupies it. */
    if (!occupied.includes(placeholder)) removePlayer(context.state, playerId(placeholder));
  }
  if (localSeat === null && !occupied.includes(context.ownSeat)) {
    removePlayer(context.state, playerId(context.ownSeat));
  }

  for (const seat of occupied) addPlayer(context.state, seat, playerId(seat));
  for (const seat of [...context.state.players.keys()]) {
    if (seat === context.ownSeat || occupied.includes(seat)) continue;
    removePlayer(context.state, playerId(seat));
  }
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

export const game: GameModule<PlatformDesign, PlatformSave> = {
  manifest: {
    id: gmManifest.id,
    sdk: '*',
    title: 'Grey-box Multiplayer',
    inputs: {
      actions: { move: 'stick', jump: 'button' },
      controls: {
        gameplay: {
          layout: 'stick',
          stick: 'move',
          buttons: [{ action: 'jump', icon: 'jump', label: 'Jump', behavior: 'tap' }],
        },
      },
    },
    presentation: { orientation: 'landscape', minLogical: { w: 640, h: 480 }, fit: 'fixed' },
    view: 'side',
    dimension: '2d',
    capabilities: gmManifest.capabilities,
    maxPlayers: gmManifest.maxPlayers,
    net: gmManifest.net as GameManifest['net'],
    palette: {
      categories: [{ id: 'level', label: 'Level', kind: 'items' }],
      items: [{ prefab: 'platform', label: 'Platform', category: 'level' }],
    },
    tools: ['select', 'place'],
    gizmos: { platform: ['translate'] },
    grid: { size: 16, units: 'px' },
    saves: true,
    overrides: { aliases: {}, retired: [] },
  },
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
      localPlayerIndex: 0,
      ownSeat: 0,
      paused: false,
      disposed: false,
      advance(dt, frames) {
        if (context.paused || context.disposed) return;
        for (const frame of frames) applyInput(context.state, frame.playerIndex, frame);
        stepSimulation(context.state, context.design, dt);
      },
    };
    activeContext = context;

    const netHooks: MultiplayerHooksV2 = {
      capture(scope: { seat?: number }): Snapshot {
        if (scope.seat === undefined) {
          return { tick: context.state.tick, state: captureShared(context.state) };
        }
        const owned = captureOwned(context.state, scope.seat);
        return { tick: context.state.tick, state: owned };
      },
      restore(snapshot: Snapshot) {
        /* Apply exactly the slice given: one seat's avatar, or the platform list. */
        const slice = snapshot.state as { seat?: number; player?: unknown } | undefined;
        if (!slice) return;
        /*
         * A seat word with no avatar means that seat is gone: its owner left or forfeited, and the seat table's
         * `despawn` already removed it here. The publish still arrives from the seat's own client, whose copy of the
         * avatar outlives the seat, so it is ignored rather than rebuilt into a ghost.
         */
        if (slice.seat !== undefined && slice.player !== undefined) restoreOwned(context.state, slice as never);
        else if ('platforms' in slice) restoreShared(context.state, slice as never);
      },
      /**
       * What `recipient` may receive from this client on this publish (netcode §5.2.1). This seat's avatar goes out
       * as it is; every other recipient gets the same avatar without its private counter, which nobody may hold but
       * the seat that counted it. The SDK calls this once per recipient and encodes exactly what it returns.
       */
      view(recipient: number): Snapshot {
        const slice = captureOwned(context.state, context.localPlayerIndex);
        if (!slice) return { tick: context.state.tick, state: { seat: context.localPlayerIndex } };
        if (recipient === context.localPlayerIndex) return { tick: context.state.tick, state: slice };
        const visible = structuredClone(slice.player) as Partial<typeof slice.player>;
        delete visible.secret;
        return { tick: context.state.tick, state: { seat: slice.seat, player: visible } };
      },
      digest() {
        // No `secret` word: a private field in a shared sum would be an oracle for exactly that field (§3.6).
        return digestSimulation(context.state, toUnits);
      },
      spawn(playerIndex, playerId) {
        addPlayer(context.state, playerIndex, playerId);
      },
      despawn(playerId) {
        removePlayer(context.state, playerId);
      },
      snapshot() {
        return { tick: context.state.tick, state: serializeSimulation(context.state) };
      },
      applySnapshot(snapshot) {
        applySnapshotState(context.state, snapshot.state as SerializedSimulation);
      },
      hud(playerIndex) {
        return hud(context.state.players, playerIndex);
      },
    };

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
            entities: data.entities && typeof data.entities === 'object' ? structuredClone(data.entities) : {},
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
          if (Math.abs(x - player.p[0]) <= 14 && y >= player.p[1] && y <= player.p[1] + 40) {
            targets.push({ id: player.id, kind: 'entity' as const });
          }
        }
        for (const platform of context.state.platforms) {
          if (Math.abs(x - platform.x) <= platform.width / 2 && y >= platform.y && y <= platform.y + platform.height) {
            targets.push({ id: platform.id, kind: 'entity' as const });
          }
        }
        return targets;
      },
      worldToScreen(id) {
        const player = playerById(context.state, id);
        if (player) {
          return (
            context.view?.worldToScreen([player.p[0], player.p[1], 0]) ?? {
              x: player.p[0],
              y: player.p[1],
            }
          );
        }
        const platform = context.state.platforms.find((candidate) => candidate.id === id);
        if (!platform) return null;
        return context.view?.worldToScreen([platform.x, platform.y, 0]) ?? { x: platform.x, y: platform.y };
      },
      validatePlacement(prefab, pose) {
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
      net: netHooks,
    };
  },
};
