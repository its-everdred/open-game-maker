import type { ActionValue, HostApi, Viewport } from '@ogm/contracts';
import type { Runtime, StepListener } from '@gm/sdk/core';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_DESIGN, createGame, type GameSave, type LevelDesign } from '../src/game.js';

class TestHost {
  readonly capabilities = new Set<string>();
  readonly inputs = new Map<string, Set<(value: ActionValue) => void>>();

  readonly input: HostApi['input'] = {
    on: (action, callback) => {
      const listeners = this.inputs.get(action) ?? new Set();
      listeners.add(callback);
      this.inputs.set(action, listeners);
      return () => listeners.delete(callback);
    },
  };

  readonly viewport: HostApi['viewport'] = {
    onChange: () => () => undefined,
    current: () =>
      ({
        w: 640,
        h: 360,
        dpr: 1,
        orientation: 'landscape',
        safe: { top: 0, right: 0, bottom: 0, left: 0 },
      }) satisfies Viewport,
  };

  readonly events: HostApi['events'] = { emit() {} };
  readonly settings: HostApi['settings'] = {
    onChange: () => () => undefined,
  };
  readonly test: HostApi['test'] = { register() {} };

  dispatch(action: string, value: ActionValue) {
    for (const listener of this.inputs.get(action) ?? []) listener(value);
  }

  listenerCount() {
    return [...this.inputs.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

function stepRuntime() {
  const listeners = new Set<StepListener>();
  const runtime = {
    onStep(callback: StepListener) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  } as unknown as Runtime<LevelDesign, GameSave>;
  return {
    runtime,
    advance(count = 1) {
      for (let tick = 0; tick < count; tick += 1) {
        for (const listener of listeners) listener(1 / 60, []);
      }
    },
  };
}

async function mount() {
  const controller = createGame();
  const host = new TestHost();
  const instance = await controller.module.mount(host, structuredClone(DEFAULT_DESIGN));
  return { controller, host, instance };
}

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('game-3d simulation', () => {
  it('notifies scenery listeners and protects the play area', async () => {
    const { controller, instance } = await mount();
    const seen: LevelDesign[] = [];
    const unsubscribe = controller.onDesignChange((design) => seen.push(design));
    const next = controller.module.designSchema.parse({
      ...DEFAULT_DESIGN,
      globals: { ...DEFAULT_DESIGN.globals, 'scenery.settings': { lighting: 'night' } },
    });
    instance.applyDesign(next, []);
    expect(seen[0]?.globals).toHaveProperty('scenery.settings');
    expect(instance.validatePlacement?.('scenery:tree', { position: [8, 0, 0] }).ok).toBe(false);
    controller.setSceneryAssetValidator((asset) => asset === 'tree');
    expect(instance.validatePlacement?.('scenery:tree', { position: [0, 0, 0] }).ok).toBe(false);
    expect(instance.validatePlacement?.('scenery:tree', { position: [8, 0, 0] }).ok).toBe(true);
    unsubscribe();
  });

  it('accepts editor-created spawn points and uses their moved position', async () => {
    const { controller, instance } = await mount();
    const design = structuredClone(DEFAULT_DESIGN);
    const id = 'e_01K8ZTEMP00000000000000003';
    const edited = {
      ...design,
      entities: {
        ...design.entities,
        [id]: { id, prefab: 'spawn', level: 'fixed', origin: 'creator', props: { pose: { position: [2, 0, -1] } } },
      },
    };
    const parsed = controller.module.designSchema.safeParse(edited);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    instance.applyDesign(parsed.data, []);
    expect(controller.position(id)).toEqual([2, 0, -1]);
    const moved = structuredClone(parsed.data);
    const movedSpawn = moved.entities[id]!;
    if (movedSpawn.prefab !== 'spawn') throw new Error('expected spawn');
    movedSpawn.props.pose!.position = [-2, 0, 1];
    const movedDesign = controller.module.designSchema.parse(moved);
    instance.applyDesign(movedDesign, []);
    expect(controller.position(id)).toEqual([-2, 0, 1]);
    const existingId = 'spawn_01K8ZTEMP00000000000000001';
    const existing = moved.entities[existingId]!;
    existing.props.pose = { position: [1, 0, 2] };
    instance.applyDesign(controller.module.designSchema.parse(moved), []);
    expect(controller.position(existingId)).toEqual([1, 0, 2]);
    delete moved.entities[id];
    instance.applyDesign(controller.module.designSchema.parse(moved), []);
    expect(controller.position(id)).toBeUndefined();
  });
  it('does not read ambient random values or wall-clock time', () => {
    const forbidden = new RegExp(['Math', 'random|Date', 'now'].join('\\.'));
    const offenders = typescriptFiles(resolve('src')).filter((path) => forbidden.test(readFileSync(path, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('mounts and advances deterministically for 3,600 input steps', async () => {
    const { controller, host, instance } = await mount();
    const steps = stepRuntime();
    await controller.attachPhysics(steps.runtime);

    for (let tick = 0; tick < 3_600; tick += 1) {
      host.dispatch('move', { x: 1, y: 0 });
      steps.advance();
    }

    const save = instance.serialize();
    expect(save.data.tick).toBe(3_600);
    expect(save.data.players.player_0?.position[0]).toBeCloseTo(5.5, 6);
    instance.dispose();
  });

  it('round-trips serialized state through restore', async () => {
    const { host, instance } = await mount();
    host.dispatch('move', { x: 0.5, y: -0.25 });
    const saved = instance.serialize();
    host.dispatch('move', { x: -1, y: 1 });

    instance.restore(saved);

    expect(instance.serialize()).toEqual(saved);
  });

  it('applies speed live and requests a scene restart for level size', async () => {
    const { instance } = await mount();

    expect(
      instance.applyDesign({ ...structuredClone(DEFAULT_DESIGN), globals: { 'player.speed': 8, 'level.size': 12 } }, [
        { op: 'replace', path: ['globals', 'player.speed'], value: 8 },
      ]),
    ).toBe('live');
    expect(
      instance.applyDesign({ ...structuredClone(DEFAULT_DESIGN), globals: { 'player.speed': 8, 'level.size': 20 } }, [
        { op: 'replace', path: ['globals', 'level.size'], value: 20 },
      ]),
    ).toBe('restart-scene');
  });

  it('produces identical text state across two mounts', async () => {
    const first = await mount();
    const second = await mount();

    for (let tick = 0; tick < 600; tick += 1) {
      const input = { x: tick % 2 === 0 ? 1 : -0.5, y: 0.25 };
      first.host.dispatch('move', input);
      second.host.dispatch('move', input);
    }

    expect(first.instance.serialize()).toEqual(second.instance.serialize());
  });

  it('spawns network players at stable design spawns and validates bounds', async () => {
    const { controller, instance } = await mount();

    instance.net.spawn(1, 'remote-player');

    expect(controller.state().players['remote-player']?.position).toEqual([3, 1, 0]);
    expect(instance.validatePlacement?.('spawn', { position: [5, 0, 5] })).toEqual({ ok: true });
    expect(instance.validatePlacement?.('spawn', { position: [99, 0, 0] })).toEqual({
      ok: false,
      reason: 'outside level bounds',
    });
  });

  it('steps jump motion on the fixed clock and lands on the floor', async () => {
    const { controller, host, instance } = await mount();
    const steps = stepRuntime();
    await controller.attachPhysics(steps.runtime);

    host.dispatch('jump', true);
    steps.advance(30);
    expect(controller.state().players.player_0?.position[1]).toBeGreaterThan(1);

    steps.advance(120);
    expect(controller.state().players.player_0?.position[1]).toBe(1);
    instance.dispose();
  });

  it('restores the initial physics world for a pre-physics keyframe', async () => {
    const { controller, instance } = await mount();
    const initialSave = instance.serialize();
    const steps = stepRuntime();
    const physics = await controller.attachPhysics(steps.runtime);
    const transient = physics.world.createRigidBody(physics.rapier.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
    const handle = transient.handle;
    steps.advance();

    instance.restore(initialSave);

    expect(physics.world.getRigidBody(handle)).toBeNull();
    expect(controller.state().physics).toBeUndefined();
    instance.dispose();
  });

  it('removes host input listeners when disposed', async () => {
    const { host, instance } = await mount();

    expect(host.listenerCount()).toBe(2);
    instance.dispose();

    expect(host.listenerCount()).toBe(0);
  });
});
