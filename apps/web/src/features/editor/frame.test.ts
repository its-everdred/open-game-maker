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
      readyTimeoutMs: 10_000,
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
    controller.restoreSave({ saveSchemaVersion: 1, data: { room: 'crypt' } });
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
    expect(frame.send).toHaveBeenCalledWith('save.restore', {
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
