import type { Envelope, HostToGame } from '@ogm/contracts';
import { z } from 'zod';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { boot } from './boot.js';
import { RuntimeImpl } from './runtime.js';
import { createCounterGame } from '../test/fixtures/counter-game.js';

const bridge = vi.hoisted(() => ({
  close: vi.fn(),
  hostOrigin: undefined as string | undefined,
  onMessage: undefined as ((message: Envelope<string, unknown>) => void) | undefined,
  send: vi.fn(),
}));

vi.mock('@ogm/iframe-bridge', () => ({
  openGameBridge: vi.fn((options: { hostOrigin: string; onMessage: (message: Envelope<string, unknown>) => void }) => {
    bridge.hostOrigin = options.hostOrigin;
    bridge.onMessage = options.onMessage;
    return {
      ready: Promise.resolve(),
      send: bridge.send,
      close: bridge.close,
      request: vi.fn(),
      stats: () => ({ dropped: { tooLarge: 0, rateLimited: 0, invalid: 0 }, sent: 0, received: 0 }),
    };
  }),
}));

let id = 0;
const message = <T extends HostToGame['t']>(t: T, payload: Extract<HostToGame, { t: T }>['payload']) =>
  ({ v: 1, id: `host-${++id}`, t, payload }) as Extract<HostToGame, { t: T }>;

const hello = (build: 'draft' | 'test' | 'published' = 'draft') =>
  message('hello', {
    protocol: 1,
    capabilities: ['events'],
    mode: 'edit',
    build,
    playerIndex: 0,
  });

async function start(options: { helloBuild?: 'draft' | 'test' | 'published'; migrate?: boolean } = {}) {
  const fixture = createCounterGame(options);
  const pending = boot(fixture.module, { hostOrigin: 'https://app.test', headless: true });
  await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
  bridge.onMessage!(hello(options.helloBuild));
  return { ...fixture, runtime: await pending };
}

describe('boot', () => {
  beforeEach(() => {
    id = 0;
    bridge.close.mockReset();
    bridge.send.mockReset();
    bridge.hostOrigin = undefined;
    bridge.onMessage = undefined;
  });

  it('passes the placement prefab to editor projection', async () => {
    const { runtime } = await start();
    const project = vi.fn(() => [2, 3, 0] as [number, number, number]);
    runtime.instance.screenToWorld = project;
    bridge.onMessage!(message('editor.project', { x: 0.25, y: 0.75, prefab: 'scenery:tree' }));
    expect(project).toHaveBeenCalledWith(0.25, 0.75, 'scenery:tree');
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'editor.projected', payload: { position: [2, 3, 0] } }),
    );
    runtime.dispose();
  });

  it('preserves the exported RuntimeImpl constructor positions', () => {
    type RuntimeParameters = ConstructorParameters<typeof RuntimeImpl>;

    expectTypeOf<RuntimeParameters[5]>().toEqualTypeOf<() => void>();
  });

  it('mounts from schema defaults and answers hello with ready marks', async () => {
    const { module, runtime } = await start();

    expect(runtime.instance.serialize().data).toMatchObject({ counter: 0, entities: {} });
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({
        t: 'ready',
        payload: expect.objectContaining({
          manifest: expect.objectContaining({ ...module.manifest, saveSchema: 1, migratesFrom: 0 }),
          marks: expect.any(Array),
        }),
      }),
    );
    expect(runtime.hooks.marks[0]?.[0]).toBe('start');
    expect(runtime.hooks.marks.at(-1)?.[0]).toBe('frame0');
    expect(runtime.hooks.ready).toBe(true);
  });

  // The host judges stored slots against the schema the running build reports, so ready carries the instance's own.
  it('reports the mounted instance save schema and only a migration it actually implements', async () => {
    const { module } = await start({ migrate: false });

    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({
        t: 'ready',
        payload: expect.objectContaining({ manifest: expect.objectContaining({ saveSchema: 1 }) }),
      }),
    );
    const ready = bridge.send.mock.calls.find(([envelope]) => envelope.t === 'ready')?.[0];
    expect(ready?.payload.manifest).not.toHaveProperty('migratesFrom');
    expect(module.manifest).not.toHaveProperty('saveSchema');
  });

  // A static manifest is only a hint: the running build corrects a declared migration it does not implement.
  it('drops a manifest migration the mounted build cannot implement', async () => {
    const fixture = createCounterGame({ migrate: false });
    const declared = { ...fixture.module.manifest, saveSchema: 4, migratesFrom: 3 };

    const pending = boot({ ...fixture.module, manifest: declared }, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(hello('draft'));
    await pending;

    const ready = bridge.send.mock.calls.find(([envelope]) => envelope.t === 'ready')?.[0];
    expect(ready?.payload.manifest).toEqual(expect.objectContaining({ saveSchema: 1 }));
    expect(ready?.payload.manifest).not.toHaveProperty('migratesFrom');
    expect(declared).toMatchObject({ saveSchema: 4, migratesFrom: 3 });
  });

  it('uses the build manifest host origin when the caller does not provide one', async () => {
    const fixture = createCounterGame();
    fixture.module.manifest.hostOrigin = 'https://HOST-A.example.test:443';

    const pending = boot(fixture.module, { headless: true });
    const handled = pending.catch((error: unknown) => error);

    expect(bridge.hostOrigin).toBe('https://host-a.example.test');
    bridge.onMessage!(hello());
    expect(await handled).toBeInstanceOf(RuntimeImpl);
  });

  it('exposes the game bridge sender for load messages', async () => {
    const { runtime } = await start();
    bridge.send.mockClear();

    runtime.send('load.progress', { phase: 'ready', loaded: 4, total: 8, cachedBytes: 0 });

    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({
        t: 'load.progress',
        payload: { phase: 'ready', loaded: 4, total: 8, cachedBytes: 0 },
      }),
    );
  });

  it('applies valid designs once and returns the same revision', async () => {
    const { metrics } = await start();
    bridge.onMessage!(
      message('design.apply', {
        rev: 5,
        doc: { speed: 9, entities: {} },
        patches: [{ op: 'replace', path: ['speed'], value: 9 }],
      }),
    );

    await vi.waitFor(() => expect(metrics.applyCalls).toBe(1));
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'design.applied', payload: { rev: 5, result: 'live' } }),
    );

    bridge.onMessage!(message('design.apply', { rev: 6, doc: { speed: 99 }, patches: [] }));
    await vi.waitFor(() => expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({ t: 'error' })));
    expect(metrics.applyCalls).toBe(1);
  });

  it('restores the last save and reports a throwing design application', async () => {
    const { metrics, runtime } = await start();
    const applyDesign = runtime.instance.applyDesign.bind(runtime.instance);
    let throwAfterApply = true;
    runtime.instance.applyDesign = (design, patches) => {
      const result = applyDesign(design, patches);
      if (!throwAfterApply) return result;
      throwAfterApply = false;
      throw new Error('design exploded');
    };

    bridge.onMessage!(
      message('design.apply', {
        rev: 7,
        doc: { speed: 2, entities: {} },
        patches: [{ op: 'replace', path: ['speed'], value: 2 }],
      }),
    );

    await vi.waitFor(() => expect(metrics.restoreCalls).toHaveLength(1));
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({
        t: 'error',
        replyTo: expect.any(String),
        payload: expect.objectContaining({ code: 'apply_failed', message: 'Error: design exploded' }),
      }),
    );
    runtime.hooks.inject({ playerIndex: 0, tick: 0, source: 'keyboard', actions: { go: true } });
    runtime.hooks.advanceTime(17);
    expect(runtime.instance.serialize().data.counter).toBe(1);
  });

  // A watcher's Follow/Free toggle must reach the game's camera, and a game without camera modes must say so.
  it('routes editor.camera to setCamera and reports unsupported games', async () => {
    const { runtime } = await start();
    const setCamera = vi.fn();
    runtime.instance.setCamera = setCamera;
    bridge.onMessage!(message('editor.camera', { mode: 'free' }));
    bridge.onMessage!(message('editor.camera', { mode: 'follow', target: 'player_1' }));
    expect(setCamera.mock.calls).toEqual([
      ['free', undefined],
      ['follow', 'player_1'],
    ]);

    delete runtime.instance.setCamera;
    const unsupported = message('editor.camera', { mode: 'free' });
    bridge.onMessage!(unsupported);
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({
        t: 'error',
        replyTo: unsupported.id,
        payload: expect.objectContaining({ code: 'unsupported' }),
      }),
    );
  });

  it('uses the compiled build kind instead of the host claim', async () => {
    const { runtime } = await start({ helloBuild: 'published' });

    expect(runtime.build).toBe('draft');
  });

  it('migrates supported saves and rejects unsupported versions', async () => {
    const migrated = await start();
    bridge.onMessage!(message('save.restore', { saveSchemaVersion: 0, data: { counter: 4 } }));
    await vi.waitFor(() => expect(migrated.metrics.restoreCalls).toHaveLength(1));
    expect(migrated.metrics.restoreCalls[0]?.saveSchemaVersion).toBe(1);
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'save.write', payload: expect.objectContaining({ reason: 'migration' }) }),
    );

    bridge.send.mockClear();
    const unsupported = await start({ migrate: false });
    bridge.onMessage!(message('save.restore', { saveSchemaVersion: 0, data: { counter: 4 } }));
    await vi.waitFor(() =>
      expect(bridge.send).toHaveBeenCalledWith(
        expect.objectContaining({ t: 'error', payload: expect.objectContaining({ code: 'save_unsupported' }) }),
      ),
    );
    expect(unsupported.metrics.restoreCalls).toHaveLength(0);
  });

  it('does not call migrate for a save two schemas behind', async () => {
    const { metrics, runtime } = await start();
    runtime.instance.serialize = () => ({ saveSchemaVersion: 2, data: { counter: 0, entities: {}, players: [] } });
    runtime.instance.migrate = vi.fn(runtime.instance.migrate);
    bridge.onMessage!(message('save.restore', { saveSchemaVersion: 0, data: { counter: 4 } }));

    await vi.waitFor(() =>
      expect(bridge.send).toHaveBeenCalledWith(
        expect.objectContaining({ t: 'error', payload: expect.objectContaining({ code: 'save_unsupported' }) }),
      ),
    );
    expect(runtime.instance.migrate).not.toHaveBeenCalled();
    expect(metrics.restoreCalls).toHaveLength(0);
  });

  it('fans input, viewport, settings, lifecycle, and checkpoint saves through the runtime', async () => {
    const { metrics, runtime } = await start();
    const frame = { playerIndex: 0, tick: 0, source: 'keyboard' as const, actions: { go: true } };

    bridge.onMessage!(
      message('viewport', {
        w: 640,
        h: 360,
        dpr: 2,
        orientation: 'landscape',
        safe: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    );
    bridge.onMessage!(message('settings', { mute: false, volume: 0.5, textScale: 1, reduceMotion: false }));
    bridge.onMessage!(message('input.frame', frame));
    runtime.hooks.advanceTime(17);

    expect(metrics.lastViewport).toMatchObject({ w: 640, h: 360 });
    expect(metrics.lastSettings).toMatchObject({ volume: 0.5 });
    expect(runtime.instance.serialize().data.counter).toBe(1);

    bridge.onMessage!(message('lifecycle.pause', {}));
    runtime.hooks.advanceTime(1000);
    expect(runtime.clock.tick).toBe(1);
    bridge.onMessage!(message('lifecycle.resume', {}));
    bridge.onMessage!(message('mode.set', { mode: 'play' }));
    expect(runtime.mode).toBe('play');

    runtime.host.events.emit('checkpoint', { reason: 'test' });
    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({ t: 'event' }));
    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({ t: 'save.write' }));
  });

  it('samples held canvas input on each fixed step and forwards raw host hotkeys', async () => {
    const { runtime } = await start();
    const canvas = document.createElement('canvas');
    runtime.attachInput({
      canvas,
      mapping: {
        keyboard: { KeyG: 'go', Escape: 'host.pause' },
        touch: 'stick',
        gamepad: {},
        pointerLock: false,
      },
    });

    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
    runtime.hooks.advanceTime(34);
    expect(runtime.instance.serialize().data.counter).toBe(2);

    canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG' }));
    runtime.hooks.advanceTime(17);
    expect(runtime.instance.serialize().data.counter).toBe(2);

    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'input.rawKey', payload: { code: 'Escape', down: true } }),
    );
  });

  it('applies host keyboard bindings to the runtime input', async () => {
    const { runtime } = await start();
    const canvas = document.createElement('canvas');
    const input = runtime.attachInput({
      canvas,
      mapping: { keyboard: { KeyG: 'go' }, touch: 'stick', gamepad: {}, pointerLock: false },
    });
    bridge.onMessage!(
      message('settings', {
        mute: false,
        volume: 1,
        textScale: 1,
        reduceMotion: false,
        keyboardBindings: { KeyJ: 'go' },
      }),
    );
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
    expect(input.sample(1)[0]!.actions).toEqual({ go: true });
    bridge.onMessage!(
      message('settings', {
        mute: false,
        volume: 0.5,
        textScale: 1,
        reduceMotion: false,
        keyboardBindings: { KeyJ: 'go' },
      }),
    );
    expect(input.sample(2)[0]!.actions).toEqual({ go: true });
    runtime.dispose();
  });

  it('owns host net input and post-step snapshots through Runtime.net', async () => {
    const { runtime } = await start();
    const received = vi.fn();
    runtime.net.onInput(received);
    bridge.onMessage!(
      message('net.players', {
        local: 0,
        players: [
          { playerIndex: 0, name: 'Host', connected: true },
          { playerIndex: 1, name: 'Peer', connected: true },
        ],
      }),
    );
    bridge.onMessage!(message('net.role', { role: 'host' }));
    bridge.send.mockClear();
    bridge.onMessage!(message('net.input', { f: { playerIndex: 1, seq: 1, tick: 1, axes: [], buttons: 1 } }));
    runtime.hooks.advanceTime(3_000);

    expect(received).toHaveBeenCalledWith(1, expect.objectContaining({ source: 'network', actions: { go: true } }));
    expect(runtime.instance.serialize().data.counter).toBe(1);
    expect(bridge.send.mock.calls.filter(([envelope]) => envelope.t === 'net.snapshot')).toHaveLength(60);
    expect(bridge.send.mock.calls.some(([envelope]) => envelope.t === 'net.input')).toBe(false);
    expect(runtime.hooks.renderGameToText()).toMatchObject({
      players: [{ playerIndex: 0 }, { playerIndex: 1 }],
      net: { role: 'host', localPlayerIndex: 0, players: [0, 1] },
    });
  });

  it('sends peer input without advancing gameplay simulation', async () => {
    const { runtime } = await start();
    bridge.onMessage!(
      message('net.players', {
        local: 1,
        players: [
          { playerIndex: 0, name: 'Host', connected: true },
          { playerIndex: 1, name: 'Peer', connected: true },
        ],
      }),
    );
    bridge.onMessage!(message('net.role', { role: 'peer' }));
    bridge.send.mockClear();

    runtime.hooks.inject({ playerIndex: 1, tick: 1, source: 'keyboard', actions: { go: true } });
    runtime.hooks.advanceTime(17);

    expect(runtime.instance.serialize().data.counter).toBe(0);
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'net.input', payload: { f: expect.objectContaining({ buttons: 1 }) } }),
    );
    expect(bridge.send.mock.calls.some(([envelope]) => envelope.t === 'net.snapshot')).toBe(false);
  });

  // Templates and three/physics drive gameplay through Runtime.onStep; its signature and host/solo
  // behavior must stay what it was when it delegated to clock.onStep. Only peers skip it (no local sim).
  it('keeps Runtime.onStep firing with merged frames on solo/host and only silences it on peers', async () => {
    const { runtime } = await start();
    const step = vi.fn();
    const stop = runtime.onStep(step);

    runtime.hooks.inject({ playerIndex: 0, tick: 1, source: 'keyboard', actions: { go: true } });
    runtime.hooks.advanceTime(17);
    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledWith(1 / 60, [expect.objectContaining({ actions: { go: true } })]);

    bridge.onMessage!(
      message('net.players', {
        local: 1,
        players: [
          { playerIndex: 0, name: 'Host', connected: true },
          { playerIndex: 1, name: 'Peer', connected: true },
        ],
      }),
    );
    bridge.onMessage!(message('net.role', { role: 'peer' }));
    runtime.hooks.advanceTime(17);
    expect(step).toHaveBeenCalledTimes(1);

    bridge.onMessage!(message('net.role', { role: 'host' }));
    runtime.hooks.advanceTime(17);
    expect(step).toHaveBeenCalledTimes(2);
    stop();
    runtime.hooks.advanceTime(17);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('keeps default single-player net traffic-free over six hundred ticks', async () => {
    const { runtime } = await start();
    bridge.send.mockClear();

    runtime.hooks.advanceTime(10_000);

    expect(runtime.net.role).toBe('host');
    expect(runtime.net.players).toHaveLength(1);
    expect(runtime.hooks.renderGameToText()).toMatchObject({
      net: { role: 'host', localPlayerIndex: 0, players: [0] },
    });
    expect(bridge.send.mock.calls.some(([envelope]) => String(envelope.t).startsWith('net.'))).toBe(false);
    expect(runtime.hooks.renderInfo()).toMatchObject({
      net: { dropped: 0, eventGaps: 0, outOfOrderSnapshots: 0, stalls: 0, oversized: 0 },
    });
  });

  it('replays recorded merged frames without current held input leaking into history', async () => {
    const { runtime } = await start();
    const canvas = document.createElement('canvas');
    runtime.attachInput({
      canvas,
      mapping: {
        keyboard: { KeyG: 'go' },
        touch: 'stick',
        gamepad: {},
        pointerLock: false,
      },
    });

    runtime.hooks.advanceTime(17);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
    runtime.hooks.advanceTime(17);
    expect(runtime.instance.serialize().data.counter).toBe(1);

    runtime.hooks.renderAt(17);
    expect(runtime.instance.serialize().data.counter).toBe(0);
  });

  it('refuses a published build forced into test mode by the URL', async () => {
    history.replaceState({}, '', '?build=test');
    const fixture = createCounterGame();
    const pending = boot(fixture.module, { hostOrigin: 'https://app.test', build: 'published', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(hello());

    await expect(pending).rejects.toThrow('published build');
    history.replaceState({}, '', '/');
  });

  it('rejects a mismatched host protocol before mounting', async () => {
    const fixture = createCounterGame();
    const pending = boot(fixture.module, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(message('hello', { ...hello().payload, protocol: 2 }));

    await expect(pending).rejects.toThrow('unsupported host protocol 2');
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'error', payload: expect.objectContaining({ code: 'protocol_mismatch' }) }),
    );
  });

  it('fails before ready when the module has no default design', async () => {
    const fixture = createCounterGame();
    fixture.module.designSchema = z.object({
      speed: z.number(),
      entities: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
    });
    const pending = boot(fixture.module, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(hello());

    await expect(pending).rejects.toThrow();
    expect(bridge.close).toHaveBeenCalledOnce();
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'error', payload: expect.objectContaining({ code: 'boot_failed' }) }),
    );
  });

  it('disposes a mounted game when later boot initialization fails', async () => {
    const fixture = createCounterGame();
    const mount = fixture.module.mount.bind(fixture.module);
    fixture.module.mount = async (...args) => {
      const instance = await mount(...args);
      instance.serialize = () => {
        throw new Error('serialize failed');
      };
      return instance;
    };
    const pending = boot(fixture.module, { hostOrigin: 'https://app.test', headless: true });
    await vi.waitFor(() => expect(bridge.onMessage).toBeTypeOf('function'));
    bridge.onMessage!(hello());

    await expect(pending).rejects.toThrow('serialize failed');
    expect(fixture.metrics.disposed).toBe(1);
    expect(bridge.close).toHaveBeenCalledOnce();
  });

  it('finishes SDK cleanup when the game disposer throws', async () => {
    const { runtime } = await start();
    expect(window.__gm).toBeDefined();
    runtime.instance.dispose = () => {
      throw new Error('dispose failed');
    };

    expect(() => runtime.dispose()).toThrow('dispose failed');
    expect(window.__gm).toBeUndefined();
    expect(bridge.close).toHaveBeenCalledOnce();
  });
});
