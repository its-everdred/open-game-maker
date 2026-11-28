import { afterEach, describe, expect, it, vi } from 'vitest';

import { HostBridge } from './bridge.js';
import { createGameFrame, HostError } from './frame.js';

afterEach(() => document.body.replaceChildren());

describe('createGameFrame', () => {
  it('keeps a live build in an opaque frame pinned to its generation', () => {
    const frame = createGameFrame({
      container: document.createElement('div'),
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g1',
      buildId: 'pv-123',
      live: true,
      liveVersion: 'generation',
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
    });
    expect(new URL(frame.iframe.src).pathname).toBe('/l/g1/pv-123/generation/index.html');
    expect(frame.iframe.getAttribute('sandbox')).toBe('allow-scripts allow-pointer-lock');
    frame.dispose();
  });
  it('places a draft grant in a scoped URL outside the game cache worker', () => {
    const container = document.createElement('div');
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      gameId: 'g1',
      buildId: 'b1',
      draftGrant: 'secret',
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
    });
    expect(new URL(frame.iframe.src).pathname).toBe('/d/g1/b1/secret/index.html');
    expect(frame.iframe.getAttribute('sandbox')).toBe('allow-scripts allow-pointer-lock');
    frame.dispose();
  });
  it('keeps preview frames outside the published-build service worker scope', () => {
    const container = document.createElement('div');
    const onError = vi.fn();
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g1',
      buildId: 'pv-123',
      preview: true,
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
      onError,
    });
    expect(new URL(frame.iframe.src).pathname).toBe('/p/g1/pv-123/index.html');
    expect(frame.iframe.getAttribute('sandbox')).toBe('allow-scripts allow-pointer-lock');
    frame.iframe.dispatchEvent(new Event('load'));
    frame.iframe.dispatchEvent(new Event('load'));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'frame-navigation' }));
    expect(container.querySelector('iframe')).toBeNull();
    frame.dispose();
  });
  it('sets the exact iframe attributes and games-origin URL', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'game one',
      buildId: 'build/one',
      build: 'draft' as const,
      mode: 'play' as const,
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
    });

    expect(frame.iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-pointer-lock');
    expect(frame.iframe.getAttribute('allow')).toBe('autoplay; fullscreen; gamepad');
    expect(frame.iframe.getAttribute('referrerpolicy')).toBe('origin');
    expect(frame.iframe.src).toBe(
      'https://games.test/g/game%20one/build%2Fone/index.html?build=draft&protocol=1&frameObserver=2',
    );
    frame.dispose();
  });

  // A review deck's playable slice (#608) boots the game in a scenario; the host still owns build and protocol.
  it('adds scenario parameters to the game URL without letting them replace the host’s own', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g1',
      buildId: 'b1',
      build: 'draft' as const,
      params: { scenario: 'sandbox', speed: 'slow', build: 'published' },
      mode: 'play' as const,
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
    });

    const url = new URL(frame.iframe.src);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scenario: 'sandbox',
      speed: 'slow',
      build: 'draft',
      protocol: '1',
      frameObserver: '2',
    });
    frame.dispose();
  });

  it('refuses an app-origin games URL without appending an iframe', () => {
    const container = document.createElement('div');
    expect(() =>
      createGameFrame({
        container,
        gamesOrigin: 'https://app.test/games',
        appOrigin: 'https://app.test',
        gameId: 'g',
        buildId: 'b',
        build: 'draft',
        mode: 'play',
        playerIndex: 0,
        capabilities: [],
        role: () => 'owner',
      }),
    ).toThrow(new HostError('same-origin'));
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('refuses a non-web games URL', () => {
    const container = document.createElement('div');
    expect(() =>
      createGameFrame({
        container,
        gamesOrigin: 'data:text/html,game',
        appOrigin: 'https://app.test',
        gameId: 'g',
        buildId: 'b',
        build: 'draft',
        mode: 'play',
        playerIndex: 0,
        capabilities: [],
        role: () => 'owner',
      }),
    ).toThrow(new HostError('invalid-origin'));
    expect(container.childElementCount).toBe(0);
  });

  it('removes the frame on dispose', () => {
    const close = vi.spyOn(HostBridge.prototype, 'close');
    const container = document.createElement('div');
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g',
      buildId: 'b',
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
    });
    frame.dispose();
    expect(container.childElementCount).toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not change local input mode when the role gate rejects mode.set', () => {
    const container = document.createElement('div');
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g',
      buildId: 'b',
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'watcher',
    });
    const setPadMode = vi.spyOn(frame.gamepads, 'setMode');
    const setOverlayEnabled = vi.spyOn(frame.overlay, 'setEnabled');

    frame.setMode('edit');

    expect(setPadMode).not.toHaveBeenCalled();
    expect(setOverlayEnabled).not.toHaveBeenCalled();
    frame.dispose();
  });

  it('accepts first-frame signals only from its own games-origin iframe', () => {
    const onLoad = vi.fn();
    const on = vi.spyOn(HostBridge.prototype, 'on');
    const container = document.createElement('div');
    document.body.append(container);
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g',
      buildId: 'b',
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
      onLoad,
    });
    const onReady = on.mock.calls.find(([type]) => type === 'ready')?.[1] as (payload: unknown) => void;
    on.mockRestore();
    onReady({ manifest: { inputs: { actions: {} } }, marks: [] });
    const data = { type: 'ogm.frame.ready.v2' };
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: 'https://evil.test', source: frame.iframe.contentWindow }),
    );
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'https://games.test', source: window }));
    expect(onLoad).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: 'https://games.test', source: frame.iframe.contentWindow }),
    );
    expect(onLoad).toHaveBeenCalledWith({ t: 'load.frame', payload: {} });
    frame.dispose();
    onLoad.mockClear();
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: 'https://games.test', source: frame.iframe.contentWindow }),
    );
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('ignores observed canvas draws when the SDK promises its own frame signal', () => {
    const legacyLoad = vi.fn();
    const legacyOn = vi.spyOn(HostBridge.prototype, 'on');
    const legacyContainer = document.createElement('div');
    document.body.append(legacyContainer);
    const legacy = createGameFrame({
      container: legacyContainer,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g',
      buildId: 'b',
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
      onLoad: legacyLoad,
    });
    const legacyReady = legacyOn.mock.calls.find(([type]) => type === 'ready')?.[1] as (payload: unknown) => void;
    legacyOn.mockRestore();
    legacyReady({ manifest: { inputs: { actions: {} } }, marks: [] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'ogm.frame.ready.v2' },
        origin: 'https://games.test',
        source: legacy.iframe.contentWindow,
      }),
    );
    expect(legacyLoad).toHaveBeenCalledWith({ t: 'load.frame', payload: {} });
    legacy.dispose();
    const onLoad = vi.fn();
    const on = vi.spyOn(HostBridge.prototype, 'on');
    const container = document.createElement('div');
    document.body.append(container);
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g',
      buildId: 'b',
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
      onLoad,
    });
    const onReady = on.mock.calls.find(([type]) => type === 'ready')?.[1] as (payload: unknown) => void;
    on.mockRestore();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'ogm.frame.ready.v2' },
        origin: 'https://games.test',
        source: frame.iframe.contentWindow,
      }),
    );
    onReady({ manifest: { inputs: { actions: {} } }, marks: [], firstFrameSignal: true });
    expect(onLoad).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'ogm.frame.ready.v2' },
        origin: 'https://games.test',
        source: frame.iframe.contentWindow,
      }),
    );
    expect(onLoad).not.toHaveBeenCalled();
    const receive = (frame.bridge as unknown as { receive(message: unknown): void }).receive.bind(frame.bridge);
    receive({ v: 1, id: 'real-frame', t: 'load.frame', payload: {} });
    expect(onLoad).toHaveBeenCalledWith({ t: 'load.frame', payload: {} });
    frame.dispose();
  });

  it('accepts opaque preview readiness only from its own frame', () => {
    const onLoad = vi.fn();
    const on = vi.spyOn(HostBridge.prototype, 'on');
    const container = document.createElement('div');
    document.body.append(container);
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g',
      buildId: 'p',
      preview: true,
      build: 'draft',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
      onLoad,
    });
    const onReady = on.mock.calls.find(([type]) => type === 'ready')?.[1] as (payload: unknown) => void;
    on.mockRestore();
    onReady({ manifest: { inputs: { actions: {} } }, marks: [] });
    const data = { type: 'ogm.frame.ready.v2' };
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source: window }));
    expect(onLoad).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source: frame.iframe.contentWindow }));
    expect(onLoad).toHaveBeenCalledWith({ t: 'load.frame', payload: {} });
    frame.dispose();
  });

  it('forwards validated load progress and completion messages', () => {
    const container = document.createElement('div');
    const onLoad = vi.fn();
    const options = {
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g',
      buildId: 'b',
      build: 'draft' as const,
      mode: 'play' as const,
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner' as const,
      onLoad,
    };
    const frame = createGameFrame(options);
    const receive = (frame.bridge as unknown as { receive(message: unknown): void }).receive.bind(frame.bridge);
    const progress = {
      v: 1,
      id: 'game-load-1',
      t: 'load.progress',
      payload: { phase: 'ready', loaded: 50, total: 100, cachedBytes: 20 },
    };
    const done = {
      v: 1,
      id: 'game-load-2',
      t: 'load.done',
      payload: {
        ms: 400,
        fetchedBytes: 80,
        cachedBytes: 20,
        fetchedFiles: 2,
        cachedFiles: 1,
        persisted: true,
      },
    };

    receive(progress);
    receive(done);
    receive({ v: 1, id: 'game-load-3', t: 'load.frame', payload: {} });

    expect(onLoad).toHaveBeenNthCalledWith(1, { t: 'load.progress', payload: progress.payload });
    expect(onLoad).toHaveBeenNthCalledWith(2, { t: 'load.done', payload: done.payload });
    expect(onLoad).toHaveBeenNthCalledWith(3, { t: 'load.frame', payload: {} });
    frame.dispose();
  });

  /* An uncaught error inside a game is reported, but must not turn into the fatal "Try again" overlay. */
  it('forwards game faults without failing the frame', () => {
    const container = document.createElement('div');
    const onFault = vi.fn();
    const onError = vi.fn();
    const frame = createGameFrame({
      container,
      gamesOrigin: 'https://games.test',
      appOrigin: 'https://app.test',
      gameId: 'g',
      buildId: 'b',
      build: 'published',
      mode: 'play',
      playerIndex: 0,
      capabilities: [],
      role: () => 'player',
      onFault,
      onError,
    });
    const receive = (frame.bridge as unknown as { receive(message: unknown): void }).receive.bind(frame.bridge);
    const fault = { kind: 'error', message: 'TypeError: helm is undefined', stack: 'at tick (helm.js:4:2)' };

    receive({ v: 1, id: 'game-fault-1', t: 'fault', payload: fault });

    expect(onFault).toHaveBeenCalledWith(fault);
    expect(onError).not.toHaveBeenCalled();
    frame.dispose();
  });

  it('selects controls from the manifest while honoring self-drawn controls and explicit mappings', () => {
    const readyWith = (
      actions: Record<string, 'stick' | 'button'>,
      touch?: 'self',
      mapping?: 'tap' | 'stick' | 'two-stick',
    ) => {
      const on = vi.spyOn(HostBridge.prototype, 'on');
      const frame = createGameFrame({
        container: document.createElement('div'),
        gamesOrigin: 'https://games.test',
        appOrigin: 'https://app.test',
        gameId: 'g',
        buildId: 'b',
        build: 'draft',
        mode: 'play',
        playerIndex: 0,
        capabilities: [],
        role: () => 'owner',
        inputMapping: mapping ? { touch: mapping } : undefined,
      });
      const onReady = on.mock.calls.find(([type]) => type === 'ready')?.[1] as (payload: unknown) => void;
      on.mockRestore();
      onReady({ manifest: { inputs: { actions, touch } }, marks: [] });
      const layer = frame.iframe.nextElementSibling as HTMLElement;
      const result = {
        sticks: layer.querySelectorAll('[data-stick]').length,
        buttons: layer.querySelectorAll('button').length,
      };
      frame.dispose();
      return result;
    };

    expect(readyWith({ jump: 'button' })).toEqual({ sticks: 0, buttons: 1 });
    expect(readyWith({ move: 'stick', jump: 'button' })).toEqual({ sticks: 1, buttons: 1 });
    expect(readyWith({ move: 'stick', look: 'stick', fire: 'button' })).toEqual({ sticks: 2, buttons: 1 });
    expect(readyWith({ move: 'stick', jump: 'button' }, 'self')).toEqual({ sticks: 0, buttons: 0 });
    expect(readyWith({ move: 'stick', jump: 'button' }, undefined, 'tap')).toEqual({ sticks: 0, buttons: 0 });
  });
});
