import type { HostApi, Patch } from '@ogm/contracts';
import { describe, expect, it, vi } from 'vitest';

import { manifest } from '../src/manifest.js';
import { connectPhaserLifecycle, defaultDesign, game, getGameContext } from '../src/game.js';
import { applyInput, createSimulation, serializeSimulation, stepSimulation } from '../src/state.js';

const moveFrame = {
  playerIndex: 0,
  tick: 1,
  source: 'keyboard' as const,
  actions: { move: 1 },
};

describe('platformer simulation', () => {
  it('declares a stick and responds to touch movement', () => {
    expect(manifest.inputs.actions.move).toBe('stick');
    const state = createSimulation(defaultDesign);
    const initialX = state.players.get(0)!.pos.x;
    applyInput(state, { ...moveFrame, source: 'touch', actions: { move: { x: 1, y: 0 } } });
    stepSimulation(state, defaultDesign, 1 / 60);
    expect(state.players.get(0)!.pos.x).toBeGreaterThan(initialX);
  });

  it('steps 3,600 frames from plain input data', () => {
    const state = createSimulation(defaultDesign);
    const initialX = state.players.get(0)!.pos.x;
    applyInput(state, moveFrame);

    for (let index = 0; index < 3_600; index += 1) stepSimulation(state, defaultDesign, 1 / 60);

    expect(state.tick).toBe(3_600);
    expect(state.players.get(0)!.pos.x).toBeGreaterThan(initialX);
  });

  it('jumps from the ground and lands again', () => {
    const state = createSimulation(defaultDesign);
    const player = state.players.get(0)!;
    const groundY = player.pos.y;

    applyInput(state, { ...moveFrame, actions: { jump: true } });
    stepSimulation(state, defaultDesign, 1 / 60);
    expect(player.pos.y).toBeLessThan(groundY);
    expect(player.onGround).toBe(false);

    for (let index = 0; index < 120; index += 1) stepSimulation(state, defaultDesign, 1 / 60);
    expect(player.pos.y).toBe(groundY);
    expect(player.onGround).toBe(true);
  });

  it('is deterministic for identical frames', () => {
    const first = createSimulation(defaultDesign);
    const second = createSimulation(defaultDesign);
    applyInput(first, moveFrame);
    applyInput(second, moveFrame);

    for (let index = 0; index < 600; index += 1) {
      stepSimulation(first, defaultDesign, 1 / 60);
      stepSimulation(second, defaultDesign, 1 / 60);
    }

    expect(serializeSimulation(first)).toEqual(serializeSimulation(second));
  });
});

describe('2D game module', () => {
  const host = {} as HostApi;

  it('serializes and restores equal state', async () => {
    const instance = await game.mount(host, defaultDesign);
    instance.net.spawn(1, 'player-b');
    const saved = instance.serialize();

    instance.net.despawn('player-b');
    instance.restore(saved);

    expect(instance.serialize()).toEqual(saved);
  });

  it('migrates an older save with missing simulation fields', async () => {
    const instance = await game.mount(host, defaultDesign);

    expect(instance.migrate?.({ saveSchemaVersion: 0, data: {} })).toEqual({
      saveSchemaVersion: 1,
      data: { tick: 0, players: [] },
    });
  });

  it('releases the mounted template context when disposed', async () => {
    const instance = await game.mount(host, defaultDesign);

    instance.dispose();

    expect(() => getGameContext()).toThrow('game context is not mounted');
  });

  it('applies speed live and level width with a scene restart', async () => {
    const instance = await game.mount(host, defaultDesign);
    const speedPatch: Patch = { op: 'replace', path: ['globals', 'player.speed'], value: 300 };
    const widthPatch: Patch = { op: 'replace', path: ['globals', 'level.width'], value: 2000 };

    expect(
      instance.applyDesign({ ...defaultDesign, globals: { ...defaultDesign.globals, 'player.speed': 300 } }, [
        speedPatch,
      ]),
    ).toBe('live');
    expect(
      instance.applyDesign({ ...defaultDesign, globals: { ...defaultDesign.globals, 'level.width': 2000 } }, [
        widthPatch,
      ]),
    ).toBe('restart-scene');
  });

  it('restarts the scene when entity patches change platform views', async () => {
    const instance = await game.mount(host, defaultDesign);
    const restartScene = vi.fn();
    connectPhaserLifecycle({ pause: vi.fn(), resume: vi.fn(), dispose: vi.fn(), restartScene });
    const next = structuredClone(defaultDesign);
    next.entities.platform_01K8ZTEMP00000000000000003!.props.x = 480;
    const patch: Patch = {
      op: 'replace',
      path: ['entities', 'platform_01K8ZTEMP00000000000000003', 'props', 'x'],
      value: 480,
    };

    expect(instance.applyDesign(next, [patch])).toBe('restart-scene');
    expect(restartScene).toHaveBeenCalledOnce();
  });

  it('rejects out-of-bounds and overlapping platform placement', async () => {
    const instance = await game.mount(host, defaultDesign);

    expect(instance.validatePlacement?.('platform', { position: [-1, 300, 0] })).toEqual({
      ok: false,
      reason: 'outside level bounds',
    });
    expect(instance.validatePlacement?.('platform', { position: [400, 320, 0] })).toEqual({
      ok: false,
      reason: 'overlaps an existing platform',
    });
    expect(instance.validatePlacement?.('platform', { position: [700, 300, 0] })).toEqual({ ok: true });
  });

  it('uses the mounted view transform for picking and projection', async () => {
    const instance = await game.mount(host, defaultDesign);
    getGameContext().view = {
      screenToWorld: () => [400, 320],
      worldToScreen: ([x, y]) => ({ x: x - 100, y: y - 50 }),
    };

    expect(instance.pick?.(0, 0)).toEqual([{ id: 'platform_01K8ZTEMP00000000000000003', kind: 'entity' }]);
    expect(instance.worldToScreen?.('platform_01K8ZTEMP00000000000000003')).toEqual({ x: 300, y: 270 });
  });
});
