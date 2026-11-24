import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameFrameOptions } from '@gm/host';
import type { DesignDoc, GameManifest } from '@ogm/contracts/browser';

import { mountGameFrame } from './frame';

const manifest = {
  id: 'cellar',
  title: 'Goblin Cellar',
  inputs: { actions: {} },
} as GameManifest;

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('game frame adapter', () => {
  it('does not consume startup writes when an away observer subscribes first', () => {
    const listeners = new Map<string, Set<(payload: never) => void>>();
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn((type: string, callback: (payload: never) => void) => {
        const callbacks = listeners.get(type) ?? new Set();
        callbacks.add(callback);
        listeners.set(type, callbacks);
        return () => callbacks.delete(callback);
      }),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: () => frame,
    });
    const observe = vi.fn();
    controller.observeSaveWrite!(observe);
    const migrated = { saveSchemaVersion: 1, data: { migrated: true } };
    for (const callback of listeners.get('save.write') ?? []) callback(migrated as never);
    const persist = vi.fn();
    controller.onSaveWrite(persist);
    expect(observe).toHaveBeenCalledWith(migrated);
    expect(persist).toHaveBeenCalledWith(migrated);
    controller.dispose();
  });
  it('restores a save before releasing an acknowledged startup hold', async () => {
    let options: GameFrameOptions | undefined;
    let resolveSave!: (save: { saveSchemaVersion: number; data: unknown }) => void;
    let restored!: () => void;
    let startupWrite!: (value: { saveSchemaVersion: number; data: unknown }) => void;
    const save = { saveSchemaVersion: 1, data: { room: 'crypt' } };
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn((type: string, callback: (payload: never) => void) => {
        if (type === 'save.restored') restored = () => callback(undefined as never);
        if (type === 'save.write') startupWrite = (value) => callback(value as never);
        return vi.fn();
      }),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: (value) => {
        options = value;
        return frame;
      },
      startupRestore: () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    });
    expect(options?.startupHold).toBe(true);
    options?.onReady?.(manifest, [], true);
    expect(controller.state().bridgeState).toBe('connecting');
    await vi.waitFor(() => expect(resolveSave).toBeTypeOf('function'));
    resolveSave(save);
    await vi.waitFor(() => expect(frame.send).toHaveBeenCalledWith('save.restore', save));
    expect(controller.state().bridgeState).toBe('connecting');
    startupWrite(save);
    restored();
    await vi.waitFor(() => expect(controller.state().bridgeState).toBe('ready'));
    expect(frame.send.mock.calls.map(([type]) => type)).toEqual(['design.apply', 'save.restore', 'lifecycle.resume']);
    const onSaveWrite = vi.fn();
    controller.onSaveWrite(onSaveWrite);
    expect(onSaveWrite).toHaveBeenCalledWith(save);
    controller.dispose();
  });
  it('protects an existing save when a legacy game cannot hold startup', async () => {
    let options: GameFrameOptions | undefined;
    const restore = vi.fn().mockResolvedValue({ saveSchemaVersion: 1, data: {} });
    const error = vi.fn();
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn(() => vi.fn()),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: (value) => {
        options = value;
        return frame;
      },
      startupRestore: restore,
      onStartupRestoreError: error,
    });
    options?.onReady?.({ ...manifest, saves: true }, []);
    await vi.waitFor(() =>
      expect(controller.state()).toMatchObject({
        bridgeState: 'ready',
        startupSaveError: true,
        startupRecoveryUnavailable: true,
      }),
    );
    expect(restore).toHaveBeenCalledOnce();
    expect(frame.send).not.toHaveBeenCalledWith('save.restore', expect.anything());
    expect(error).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it('keeps saving available for a legacy game with no existing save', async () => {
    let options: GameFrameOptions | undefined;
    const restore = vi.fn().mockResolvedValue(undefined);
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn(() => vi.fn()),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: (value) => {
        options = value;
        return frame;
      },
      startupRestore: restore,
    });
    options?.onReady?.({ ...manifest, saves: true }, []);
    await vi.waitFor(() => expect(controller.state().bridgeState).toBe('ready'));
    expect(restore).toHaveBeenCalledOnce();
    expect(controller.state().startupSaveError).toBeUndefined();
    controller.dispose();
  });
  it('disables legacy manual recovery when the startup lookup fails', async () => {
    let options: GameFrameOptions | undefined;
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn(() => vi.fn()),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: (value) => {
        options = value;
        return frame;
      },
      startupRestore: async () => {
        throw new Error('lookup failed');
      },
    });
    options?.onReady?.({ ...manifest, saves: true }, []);
    await vi.waitFor(() =>
      expect(controller.state()).toMatchObject({
        bridgeState: 'ready',
        startupSaveError: true,
        startupRecoveryUnavailable: true,
      }),
    );
    controller.dispose();
  });
  it('disables saving for the session when the startup load fails', async () => {
    let options: GameFrameOptions | undefined;
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn(() => vi.fn()),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const error = vi.fn();
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: (value) => {
        options = value;
        return frame;
      },
      startupRestore: async () => {
        throw new Error('offline');
      },
      onStartupRestoreError: error,
    });
    options?.onReady?.(manifest, [], true);
    await vi.waitFor(() => expect(controller.state()).toMatchObject({ bridgeState: 'ready', startupSaveError: true }));
    expect(error).toHaveBeenCalledOnce();
    expect(frame.send).toHaveBeenCalledWith('lifecycle.resume', {});
    controller.dispose();
  });
  it('drops buffered edit-mode writes when returning to play', () => {
    const callbacks = new Map<string, (payload: never) => void>();
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn((type: string, callback: (payload: never) => void) => {
        callbacks.set(type, callback);
        return vi.fn();
      }),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: () => frame,
    });
    controller.setMode('edit');
    callbacks.get('save.write')?.({ saveSchemaVersion: 1, data: { edit: true } } as never);
    controller.setMode('play');
    const write = vi.fn();
    controller.onSaveWrite(write);
    expect(write).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('re-enables saving only after a manual restore is acknowledged', async () => {
    let options: GameFrameOptions | undefined;
    let restored!: (save: { saveSchemaVersion: number; data: unknown }) => void;
    let lateAck!: () => void;
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn((type: string, callback: () => void) => {
        if (type === 'save.restored') lateAck = callback;
        return vi.fn();
      }),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      restoreSave: vi.fn(
        () =>
          new Promise<{ saveSchemaVersion: number; data: unknown }>((resolve) => {
            restored = resolve;
          }),
      ),
      dispose: vi.fn(),
    };
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: (value) => {
        options = value;
        return frame;
      },
      startupRestore: async () => {
        throw new Error('offline');
      },
    });
    options?.onReady?.(manifest, [], true);
    await vi.waitFor(() => expect(controller.state().startupSaveError).toBe(true));
    lateAck();
    expect(controller.state().startupSaveError).toBe(true);
    const recovery = controller.restoreSave({ saveSchemaVersion: 1, data: {} });
    expect(controller.state().startupSaveError).toBe(true);
    restored({ saveSchemaVersion: 1, data: {} });
    await recovery;
    controller.confirmSaveRecovery();
    expect(controller.state().startupSaveError).toBe(false);
    controller.dispose();
  });
  it('does not treat a rejected startup restore as successful', async () => {
    let options: GameFrameOptions | undefined;
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn(() => vi.fn()),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const error = vi.fn();
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 1, doc: {} as DesignDoc },
      create: (value) => {
        options = value;
        return frame;
      },
      startupRestore: async () => ({ saveSchemaVersion: 1, data: {} }),
      onStartupRestoreError: error,
    });
    options?.onReady?.(manifest, [], true);
    await vi.waitFor(() => expect(frame.send).toHaveBeenCalledWith('save.restore', expect.anything()));
    options?.onError?.({ code: 'save_unsupported', message: 'unsupported' });
    await vi.waitFor(() => expect(controller.state()).toMatchObject({ bridgeState: 'ready', startupSaveError: true }));
    expect(error).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it('mounts through @gm/host, forwards mode, and counts rejected origins', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    let frameOptions: GameFrameOptions | undefined;
    const listeners = new Map<string, (payload: never) => void>();
    const frame = {
      bridge: { dropped: 2 },
      on: vi.fn((type: string, callback: (payload: never) => void) => {
        listeners.set(type, callback);
        return vi.fn();
      }),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      project: vi.fn().mockResolvedValue([2, 0, -1]),
      restoreSave: vi.fn(async (save) => save),
      dispose: vi.fn(),
    };
    const states: Array<{ bridgeState: string; dropped: number }> = [];

    const controller = mountGameFrame({
      container,
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 4, doc: {} as DesignDoc },
      create: (options) => {
        frameOptions = options;
        return frame;
      },
      onState: (state) => states.push({ bridgeState: state.bridgeState, dropped: state.dropped }),
    });

    expect(frameOptions).toMatchObject({
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      build: 'draft',
      mode: 'play',
      // A slow but live entry module (7-12 s over Funnel under load) must not hit "Try again" before hello.
      readyTimeoutMs: 30_000,
    });
    frameOptions?.onReady?.(manifest, []);
    frameOptions?.onLoad?.({
      t: 'load.progress',
      payload: { phase: 'stream', loaded: 10, total: 100, cachedBytes: 0 },
    });
    controller.setMode('edit');
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://attacker.example' }));

    expect(frame.setMode).toHaveBeenCalledWith('edit');
    expect(frame.send).toHaveBeenCalledWith('design.apply', { rev: 4, doc: {}, patches: [] });
    expect(controller.state()).toMatchObject({
      bridgeState: 'ready',
      manifest,
      dropped: 3,
      load: { phase: 'ready', done: true },
    });
    expect(states.at(-1)).toEqual({ bridgeState: 'ready', dropped: 3 });

    controller.pick(0.25, 0.75);
    await expect(controller.project(0.25, 0.75)).resolves.toEqual([2, 0, -1]);
    expect(frame.project).toHaveBeenCalledWith(0.25, 0.75);
    await controller.project(0.25, 0.75, 'scenery:tree');
    expect(frame.project).toHaveBeenCalledWith(0.25, 0.75, 'scenery:tree');
    controller.select(['e_01BX5ZZKBKACTAV9WEVGEMMVRZ']);
    controller.camera('free');
    controller.camera('follow', 'player_0');
    const firstPlacement = controller.validatePlacement('skeleton', { position: [2, 0, 3] });
    const secondPlacement = controller.validatePlacement('bat', { position: [3, 0, 4] });
    controller.pause();
    controller.resume();
    await controller.restoreSave({ saveSchemaVersion: 1, data: { room: 'crypt' } });
    expect(frame.send).toHaveBeenCalledWith('editor.pick', { x: 0.25, y: 0.75 });
    expect(frame.send).toHaveBeenCalledWith('editor.select', { ids: ['e_01BX5ZZKBKACTAV9WEVGEMMVRZ'] });
    expect(frame.send).toHaveBeenCalledWith('editor.camera', { mode: 'free' });
    expect(frame.send).toHaveBeenCalledWith('editor.camera', { mode: 'follow', target: 'player_0' });
    expect(frame.send).toHaveBeenCalledWith('editor.validatePlacement', {
      prefab: 'skeleton',
      pose: { position: [2, 0, 3] },
    });
    expect(frame.send).not.toHaveBeenCalledWith('editor.validatePlacement', {
      prefab: 'bat',
      pose: { position: [3, 0, 4] },
    });
    listeners.get('editor.placement')?.({ ok: true } as never);
    await expect(firstPlacement).resolves.toEqual({ ok: true });
    expect(frame.send).toHaveBeenCalledWith('editor.validatePlacement', {
      prefab: 'bat',
      pose: { position: [3, 0, 4] },
    });
    listeners.get('editor.placement')?.({ ok: false, reason: 'blocked' } as never);
    await expect(secondPlacement).resolves.toEqual({ ok: false, reason: 'blocked' });
    expect(frame.send).toHaveBeenCalledWith('lifecycle.pause', {});
    expect(frame.send).toHaveBeenCalledWith('lifecycle.resume', {});
    expect(frame.restoreSave).toHaveBeenCalledWith({
      saveSchemaVersion: 1,
      data: { room: 'crypt' },
    });

    controller.dispose();
    controller.dispose();
    expect(frame.dispose).toHaveBeenCalledOnce();
  });

  it('adapts validated room envelopes in both directions', () => {
    const listeners = new Map<string, (payload: never) => void>();
    let frameOptions: GameFrameOptions | undefined;
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn((type: string, callback: (payload: never) => void) => {
        listeners.set(type, callback);
        return vi.fn();
      }),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const roomMessages = vi.fn();
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        frameOptions = options;
        return frame;
      },
      onRoomMessage: roomMessages,
    });

    controller.sendRoomMessage({
      v: 1,
      id: 'room-1',
      t: 'net.role',
      payload: { role: 'peer' },
    });
    frameOptions?.onReady?.(manifest, [['boot', 1]]);
    listeners.get('net.input')?.({ f: { seq: 2, tick: 3, axes: [], buttons: 0 } } as never);
    listeners.get('net.pause.ack')?.({ epoch: 'epoch', tick: 6 } as never);

    expect(frame.send).toHaveBeenCalledWith('net.role', { role: 'peer' });
    expect(roomMessages).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'ready', payload: expect.objectContaining({ manifest }) }),
    );
    expect(roomMessages).toHaveBeenCalledWith({
      v: 1,
      id: expect.any(String),
      t: 'net.input',
      payload: { f: { seq: 2, tick: 3, axes: [], buttons: 0 } },
    });
    expect(roomMessages).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'net.pause.ack', payload: { epoch: 'epoch', tick: 6 } }),
    );
  });

  it('surfaces the host readiness timeout as a retryable error state', () => {
    const container = document.createElement('div');
    let frameOptions: GameFrameOptions | undefined;
    const controller = mountGameFrame({
      container,
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        frameOptions = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
    });

    // A game without camera modes answers a watcher's Free with `unsupported`; that must not take the game away.
    const before = controller.state();
    frameOptions?.onError?.({ code: 'unsupported', message: 'camera modes are not supported' });
    expect(controller.state()).toEqual(before);

    frameOptions?.onError?.({ code: 'ready-timeout', message: 'game did not become ready in time' });

    expect(controller.state()).toMatchObject({
      bridgeState: 'error',
      error: 'game did not become ready in time',
    });
  });

  // The SDK answers a `save.restore` it cannot read with `save_unsupported`; that is a failed Load in the pause
  // dialog, not a reason to swap the running game for the Try again screen.
  it('reports a refused save restore as a load error and leaves the game running', () => {
    let frameOptions: GameFrameOptions | undefined;
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        frameOptions = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
    });
    frameOptions?.onReady?.(manifest, []);
    const loadErrors: string[] = [];
    const stop = controller.onSaveLoadError((message) => loadErrors.push(message));
    const before = controller.state();

    frameOptions?.onError?.({ code: 'save_unsupported', message: 'save version is not supported' });

    expect(loadErrors).toEqual(['save version is not supported']);
    expect(controller.state()).toEqual(before);
    expect(controller.state().bridgeState).toBe('ready');

    stop();
    frameOptions?.onError?.({ code: 'save_unsupported', message: 'save version is not supported' });
    expect(loadErrors).toEqual(['save version is not supported']);
  });

  it('tracks load progress and fails only after twenty seconds without progress', async () => {
    vi.useFakeTimers();
    let frameOptions: GameFrameOptions | undefined;
    const onLoadStalled = vi.fn();
    const states: unknown[] = [];
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        frameOptions = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
      onLoadStalled,
      onState: (state) => states.push(state),
    });

    frameOptions?.onReady?.(manifest, []);
    expect(controller.state().load).toMatchObject({ done: true });

    frameOptions?.onLoad?.({
      t: 'load.progress',
      payload: { phase: 'ready', loaded: 25, total: 100, cachedBytes: 10 },
    });
    expect(controller.state().load).toEqual({ phase: 'ready', loaded: 25, total: 100, done: false });

    await vi.advanceTimersByTimeAsync(19_000);
    frameOptions?.onLoad?.({
      t: 'load.progress',
      payload: { phase: 'ready', loaded: 50, total: 100, cachedBytes: 10 },
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(controller.state().bridgeState).toBe('ready');

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.state()).toMatchObject({ bridgeState: 'error', errorCode: 'load-stalled' });
    expect(states).toContainEqual(expect.objectContaining({ bridgeState: 'error', errorCode: 'load-stalled' }));
    expect(onLoadStalled).toHaveBeenCalledWith(expect.objectContaining({ fetchedBytes: 40, cachedBytes: 10 }));
  });

  it('waits for delayed legacy progress and completion before revealing', async () => {
    vi.useFakeTimers();
    let opts: GameFrameOptions | undefined;
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        opts = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
    });
    opts?.onReady?.(manifest, []);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.state().firstFrame).not.toBe(true);
    opts?.onLoad?.({ t: 'load.progress', payload: { phase: 'ready', loaded: 1, total: 4, cachedBytes: 0 } });
    await vi.advanceTimersByTimeAsync(1500);
    expect(controller.state().firstFrame).not.toBe(true);
    opts?.onLoad?.({
      t: 'load.done',
      payload: { ms: 1, fetchedBytes: 4, cachedBytes: 0, fetchedFiles: 1, cachedFiles: 0, persisted: false },
    });
    expect(controller.state()).toMatchObject({ load: { done: true } });
    expect(controller.state().firstFrame).not.toBe(true);
    opts?.onLoad?.({ t: 'load.frame', payload: {} });
    expect(controller.state().firstFrame).toBe(true);
    controller.dispose();
  });

  /* Blobs compiles its shaders after its last progress report; under load that took over 20 s and "Try again" covered a
     game that then drew its first frame (#1260). A stall is silence, so the game reporting again clears it. */
  it('clears a stall when the game reports again and reveals the frame', async () => {
    vi.useFakeTimers();
    let opts: GameFrameOptions | undefined;
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        opts = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
    });
    opts?.onReady?.(manifest, []);
    opts?.onLoad?.({ t: 'load.progress', payload: { phase: 'ready', loaded: 950, total: 1000, cachedBytes: 0 } });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(controller.state()).toMatchObject({ bridgeState: 'error', errorCode: 'load-stalled' });
    opts?.onLoad?.({ t: 'load.frame', payload: {} });
    opts?.onLoad?.({
      t: 'load.done',
      payload: { ms: 1, fetchedBytes: 1, cachedBytes: 0, fetchedFiles: 1, cachedFiles: 0, persisted: false },
    });
    expect(controller.state()).toMatchObject({ bridgeState: 'ready', firstFrame: true, load: { done: true } });
    expect(controller.state().errorCode).toBeUndefined();
    controller.dispose();
  });

  it('keeps a bridge failure up when the game reports again', async () => {
    let opts: GameFrameOptions | undefined;
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        opts = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
    });
    opts?.onReady?.(manifest, []);
    opts?.onError?.({ code: 'boot_failed', message: 'boom' } as Parameters<
      NonNullable<GameFrameOptions['onError']>
    >[0]);
    opts?.onLoad?.({ t: 'load.frame', payload: {} });
    expect(controller.state()).toMatchObject({ bridgeState: 'error', errorCode: 'boot_failed' });
    controller.dispose();
  });

  it.each([false, true])('times out missing first frame after ready (assets complete: %s)', async (complete) => {
    vi.useFakeTimers();
    let opts: GameFrameOptions | undefined;
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        opts = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
    });
    opts?.onReady?.(manifest, []);
    if (complete)
      opts?.onLoad?.({
        t: 'load.done',
        payload: { ms: 1, fetchedBytes: 1, cachedBytes: 0, fetchedFiles: 1, cachedFiles: 0, persisted: false },
      });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(controller.state()).toMatchObject({ bridgeState: 'error', errorCode: 'first-frame-stalled' });
    controller.dispose();
  });

  it('keeps first-frame readiness separate from asset completion', () => {
    let frameOptions: GameFrameOptions | undefined;
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        frameOptions = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
    });
    frameOptions?.onReady?.(manifest, []);
    expect(controller.state().firstFrame).not.toBe(true);
    frameOptions?.onLoad?.({ t: 'load.frame', payload: {} });
    expect(controller.state().firstFrame).toBe(true);
    controller.dispose();
  });

  it('marks load.done terminal and cancels the stall timer', async () => {
    vi.useFakeTimers();
    let frameOptions: GameFrameOptions | undefined;
    const onLoadDone = vi.fn();
    const onLoadStalled = vi.fn();
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'play',
      design: { rev: 0, doc: {} as DesignDoc },
      create: (options) => {
        frameOptions = options;
        return {
          bridge: { dropped: 0 },
          on: vi.fn(() => vi.fn()),
          setMode: vi.fn(),
          setSettings: vi.fn(),
          send: vi.fn(),
          dispose: vi.fn(),
        };
      },
      onLoadDone,
      onLoadStalled,
    });

    frameOptions?.onLoad?.({
      t: 'load.progress',
      payload: { phase: 'ready', loaded: 40, total: 100, cachedBytes: 20 },
    });
    const done = {
      ms: 230,
      fetchedBytes: 80,
      cachedBytes: 20,
      fetchedFiles: 2,
      cachedFiles: 1,
      persisted: true,
    };
    frameOptions?.onLoad?.({ t: 'load.done', payload: done });

    expect(controller.state().load).toEqual({ phase: 'ready', loaded: 40, total: 100, done: true });
    expect(onLoadDone).toHaveBeenCalledWith(done);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onLoadStalled).not.toHaveBeenCalled();
    expect(controller.state().bridgeState).toBe('connecting');
  });

  it('does not misattribute a late placement reply after timeout', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (payload: never) => void>();
    const frame = {
      bridge: { dropped: 0 },
      on: vi.fn((type: string, callback: (payload: never) => void) => {
        listeners.set(type, callback);
        return vi.fn();
      }),
      setMode: vi.fn(),
      setSettings: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = mountGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'http://127.0.0.1:10001',
      gameId: 'game',
      buildId: 'build',
      mode: 'edit',
      design: { rev: 0, doc: {} as DesignDoc },
      create: () => frame,
    });

    const first = controller.validatePlacement('skeleton', { position: [1, 0, 1] }, 10);
    const second = controller.validatePlacement('bat', { position: [2, 0, 2] }, 10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(first).resolves.toEqual({ ok: false, reason: 'Placement validation timed out.' });
    expect(frame.send).not.toHaveBeenCalledWith('editor.validatePlacement', {
      prefab: 'bat',
      pose: { position: [2, 0, 2] },
    });

    listeners.get('editor.placement')?.({ ok: true } as never);
    expect(frame.send).toHaveBeenCalledWith('editor.validatePlacement', {
      prefab: 'bat',
      pose: { position: [2, 0, 2] },
    });
    listeners.get('editor.placement')?.({ ok: false, reason: 'blocked' } as never);
    await expect(second).resolves.toEqual({ ok: false, reason: 'blocked' });
  });
});
