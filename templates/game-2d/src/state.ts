import type { ActionFrame } from '@ogm/contracts';

import type { PlatformDesign } from './game.js';

export const PLAYER_WIDTH = 28;
export const PLAYER_HEIGHT = 40;
export const GROUND_Y = 440;
const GRAVITY = 900;
const JUMP_SPEED = 420;

export interface Platform {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlayerState {
  id: string;
  playerIndex: number;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  onGround: boolean;
}

interface PlayerInput {
  move: number;
  jumpQueued: boolean;
}

export interface SimulationState {
  tick: number;
  players: Map<number, PlayerState>;
  platforms: Platform[];
  inputs: Map<number, PlayerInput>;
}

export interface SerializedSimulation {
  tick: number;
  players: PlayerState[];
}

function spawns(design: PlatformDesign): { x: number; y: number }[] {
  return Object.values(design.entities)
    .filter((entity) => entity.prefab === 'spawn')
    .map((entity) => position(entity.props));
}

function position(props: PlatformDesign['entities'][string]['props']): { x: number; y: number } {
  return { x: props.pose?.position[0] ?? props.x!, y: props.pose?.position[1] ?? props.y! };
}

export function platformsFromDesign(design: PlatformDesign): Platform[] {
  return Object.values(design.entities)
    .filter(
      (entity): entity is Extract<PlatformDesign['entities'][string], { prefab: 'spawn' | 'platform' }> =>
        entity.prefab === 'platform',
    )
    .map((entity) => ({
      id: entity.id,
      ...position(entity.props),
      width: entity.props.w ?? 160,
      height: entity.props.h ?? 24,
    }));
}

export function addPlayer(state: SimulationState, design: PlatformDesign, playerIndex: number, id: string): void {
  const availableSpawns = spawns(design);
  const spawn = availableSpawns[playerIndex % availableSpawns.length] ?? { x: 96, y: GROUND_Y - PLAYER_HEIGHT };
  state.players.set(playerIndex, {
    id,
    playerIndex,
    pos: { x: spawn.x, y: spawn.y },
    vel: { x: 0, y: 0 },
    onGround: spawn.y + PLAYER_HEIGHT === GROUND_Y,
  });
  state.inputs.set(playerIndex, { move: 0, jumpQueued: false });
}

export function createSimulation(design: PlatformDesign): SimulationState {
  const state: SimulationState = {
    tick: 0,
    players: new Map(),
    platforms: platformsFromDesign(design),
    inputs: new Map(),
  };
  addPlayer(state, design, 0, 'local');
  return state;
}

export function applyInput(state: SimulationState, frame: ActionFrame): void {
  const input = state.inputs.get(frame.playerIndex) ?? { move: 0, jumpQueued: false };
  const move = frame.actions.move;
  if (typeof move === 'number') input.move = Math.max(-1, Math.min(1, move));
  else if (move && typeof move === 'object') input.move = Math.max(-1, Math.min(1, move.x));
  if (frame.actions.jump === true) input.jumpQueued = true;
  state.inputs.set(frame.playerIndex, input);
}

function landingY(player: PlayerState, state: SimulationState, nextY: number): number | undefined {
  const previousBottom = player.pos.y + PLAYER_HEIGHT;
  const nextBottom = nextY + PLAYER_HEIGHT;
  let surface = nextBottom >= GROUND_Y ? GROUND_Y : undefined;

  for (const platform of state.platforms) {
    const withinX =
      player.pos.x + PLAYER_WIDTH / 2 > platform.x - platform.width / 2 &&
      player.pos.x - PLAYER_WIDTH / 2 < platform.x + platform.width / 2;
    if (withinX && previousBottom <= platform.y && nextBottom >= platform.y) {
      surface = surface === undefined ? platform.y : Math.min(surface, platform.y);
    }
  }
  return surface;
}

export function stepSimulation(state: SimulationState, design: PlatformDesign, dt: number): void {
  const speed = design.globals['player.speed'];
  const levelWidth = design.globals['level.width'];

  for (const player of state.players.values()) {
    const input = state.inputs.get(player.playerIndex) ?? { move: 0, jumpQueued: false };
    player.vel.x = input.move * speed;
    player.pos.x = Math.max(
      PLAYER_WIDTH / 2,
      Math.min(levelWidth - PLAYER_WIDTH / 2, player.pos.x + player.vel.x * dt),
    );

    if (input.jumpQueued && player.onGround) {
      player.vel.y = -JUMP_SPEED;
      player.onGround = false;
    }
    input.jumpQueued = false;
    player.vel.y += GRAVITY * dt;
    const nextY = player.pos.y + player.vel.y * dt;
    const surface = player.vel.y >= 0 ? landingY(player, state, nextY) : undefined;
    if (surface === undefined) {
      player.pos.y = nextY;
      player.onGround = false;
    } else {
      player.pos.y = surface - PLAYER_HEIGHT;
      player.vel.y = 0;
      player.onGround = true;
    }
  }
  state.tick += 1;
}

export function serializeSimulation(state: SimulationState): SerializedSimulation {
  return {
    tick: state.tick,
    players: [...state.players.values()]
      .sort((left, right) => left.playerIndex - right.playerIndex)
      .map((player) => structuredClone(player)),
  };
}

export function restoreSimulation(design: PlatformDesign, saved: SerializedSimulation): SimulationState {
  const state: SimulationState = {
    tick: saved.tick,
    players: new Map(),
    platforms: platformsFromDesign(design),
    inputs: new Map(),
  };
  for (const player of saved.players) {
    state.players.set(player.playerIndex, structuredClone(player));
    state.inputs.set(player.playerIndex, { move: 0, jumpQueued: false });
  }
  return state;
}
