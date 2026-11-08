import { createGameFrame, type GameFrame, type GameFrameOptions, type GameLoadEvent } from '@gm/host';
import type {
  DesignDoc,
  Envelope,
  GameManifest,
  GameToHost,
  HostToGame,
  Patch,
  PlacementResult,
  PlayerSettings,
  Pose,
  SaveData,
  TargetRef,
} from '@ogm/contracts/browser';
import { hostToGameSchema, SDK_PROTOCOL } from '@ogm/contracts/browser';

type FrameLike = Pick<GameFrame, 'dispose' | 'on' | 'send' | 'setMode' | 'setSettings'> & {
  bridge: Pick<GameFrame['bridge'], 'dropped'>;
  /** Optional so a test double need not answer diagnostics; `netInfo()` reports `undefined` when it cannot ask. */
  request?: GameFrame['request'];
};

export type GameLoadProgress = Extract<GameLoadEvent, { t: 'load.progress' }>['payload'];
export type GameLoadDone = Extract<GameLoadEvent, { t: 'load.done' }>['payload'];

export type GameLoadMeasurement = Pick<GameLoadDone, 'ms' | 'fetchedBytes' | 'cachedBytes'>;
export type GameFrameState = {
  bridgeState: 'connecting' | 'ready' | 'error';
  dropped: number;
  manifest?: GameManifest;
  error?: string;
  errorCode?: string;
  load?: Pick<GameLoadProgress, 'phase' | 'loaded' | 'total'> & { done: boolean };
};

export type GameFrameController = {
  state(): GameFrameState;
  setMode(mode: 'play' | 'edit'): void;
  setSettings(settings: PlayerSettings): void;
  applyDesign(rev: number, doc: DesignDoc, patches: readonly Patch[]): void;
  pick(x: number, y: number): void;
  select(ids: readonly string[]): void;
  camera(mode: 'follow' | 'free', target?: string): void;
  validatePlacement(prefab: string, pose: Pose, timeoutMs?: number): Promise<PlacementResult>;
  onPicked(callback: (targets: TargetRef[]) => void): () => void;
  onScreen(
    callback: (position: { id: string; x: number; y: number } | { id: string; offscreen: true }) => void,
  ): () => void;
  pause(): void;
  resume(): void;
  restoreSave(save: SaveData<unknown>): void;
  /**
   * A `save.restore` the running build refused, as a failed Load rather than a frame error. The game keeps running.
   */
  onSaveLoadError(callback: (message: string) => void): () => void;
  sendRoomMessage(envelope: Envelope<string, unknown>): void;
  onSaveWrite(callback: (save: SaveData<unknown>) => void): () => void;
  onEvent(callback: (kind: 'achievement' | 'analytics' | 'checkpoint', payload: unknown) => void): () => void;
  /**
   * `test.renderInfo`, or `undefined` when the game refused it (a published build answers `ok: false`) or did not answer
   * within `timeoutMs`. Read by the diagnostics overlay; nothing in the product path calls it.
   */
  netInfo(timeoutMs?: number): Promise<unknown>;
  dispose(): void;
};

export type MountGameFrameOptions = {
  container: HTMLElement;
  gamesOrigin: string;
  gameId: string;
  buildId: string;
  mode: 'play' | 'edit';
  design: { rev: number; doc: DesignDoc };
  build?: 'draft' | 'test' | 'published';
  /** Query parameters the game boots with: a review deck's playable scenario (#608). */
  params?: Readonly<Record<string, string>>;
  create?(options: GameFrameOptions): FrameLike;
  onState?(state: GameFrameState): void;
  onSaveWrite?(payload: { saveSchemaVersion: number; data: unknown }): void;
  onEvent?(kind: 'achievement' | 'analytics' | 'checkpoint', payload: unknown): void;
  onRoomMessage?(envelope: Envelope<string, unknown>): void;
  onLoadDone?(measurement: GameLoadDone): void;
  onLoadStalled?(measurement: GameLoadMeasurement): void;
};

export function mountGameFrame(options: MountGameFrameOptions): GameFrameController {
  const trustedOrigin = new URL(options.gamesOrigin).origin;
  let wrongOriginDrops = 0;
  let disposed = false;
  let current: Omit<GameFrameState, 'dropped'> = { bridgeState: 'connecting' };
  let frame!: FrameLike;
  let loadObserved = false;
  let loadTerminal = false;
  let loadStallTimer: ReturnType<typeof setTimeout> | undefined;
  let lastLoadProgress: GameLoadProgress | undefined;
  const mountedAt = performance.now();
  type PlacementRequest = {
    prefab: string;
    pose: Pose;
    timeoutMs: number;
    resolve(result: PlacementResult): void;
  };
  const placementQueue: PlacementRequest[] = [];
  let activePlacement: (PlacementRequest & { timer: ReturnType<typeof setTimeout>; settled: boolean }) | undefined;
  let stopPlacement: () => void = () => undefined;
  const saveLoadErrors = new Set<(message: string) => void>();
  let roomMessageSequence = 0;
  const emitRoomMessage = (type: GameToHost['t'], payload: unknown) => {
    roomMessageSequence += 1;
    options.onRoomMessage?.({ v: 1, id: `game-room-${roomMessageSequence}`, t: type, payload });
  };

  const snapshot = (): GameFrameState => ({ ...current, dropped: frame.bridge.dropped + wrongOriginDrops });
  const publish = () => options.onState?.(snapshot());
  const clearLoadStall = () => {
    if (loadStallTimer !== undefined) clearTimeout(loadStallTimer);
    loadStallTimer = undefined;
  };
  const stallLoad = () => {
    if (disposed || loadTerminal || lastLoadProgress === undefined) return;
    loadTerminal = true;
    clearLoadStall();
    current = { ...current, bridgeState: 'error', error: 'load-stalled', errorCode: 'load-stalled' };
    publish();
    options.onLoadStalled?.({
      ms: Math.max(0, Math.round(performance.now() - mountedAt)),
      fetchedBytes: Math.max(0, lastLoadProgress.loaded - lastLoadProgress.cachedBytes),
      cachedBytes: lastLoadProgress.cachedBytes,
    });
  };
  const handleLoad = (event: GameLoadEvent) => {
    if (disposed || loadTerminal) return;
    if (event.t === 'load.done') {
      loadObserved = true;
      loadTerminal = true;
      clearLoadStall();
      const load = current.load ?? { phase: 'ready' as const, loaded: 0, total: 0, done: false };
      current = { ...current, load: { ...load, done: true } };
      publish();
      options.onLoadDone?.(event.payload);
      return;
    }
    if (event.payload.phase === 'stream') return;
    loadObserved = true;
    lastLoadProgress = event.payload;
    clearLoadStall();
    loadStallTimer = setTimeout(stallLoad, 20_000);
    current = {
      ...current,
      load: {
        phase: event.payload.phase,
        loaded: event.payload.loaded,
        total: event.payload.total,
        done: false,
      },
    };
    publish();
  };
  const observeOrigin = (event: MessageEvent) => {
    if (event.origin === trustedOrigin) return;
    wrongOriginDrops += 1;
    publish();
  };
  window.addEventListener('message', observeOrigin);

  try {
    const create = options.create ?? createGameFrame;
    frame = create({
      container: options.container,
      gamesOrigin: trustedOrigin,
      gameId: options.gameId,
      buildId: options.buildId,
      build: options.build ?? 'draft',
      ...(options.params === undefined ? {} : { params: options.params }),
      mode: options.mode,
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
      readyTimeoutMs: 10_000,
      onReady: (manifest, marks) => {
        if (current.bridgeState === 'error') return;
        current = {
          ...current,
          bridgeState: 'ready',
          manifest,
          load: loadObserved ? current.load : { phase: 'ready', loaded: 0, total: 0, done: true },
        };
        frame.send('design.apply', { rev: options.design.rev, doc: options.design.doc, patches: [] });
        emitRoomMessage('ready', { protocol: SDK_PROTOCOL, manifest, marks });
        publish();
      },
      onLoad: handleLoad,
      onSaveWrite: options.onSaveWrite,
      onEvent: options.onEvent,
      onError: (failure) => {
        /* The game declined an optional command (a camera mode, selection) and keeps running. */
        if (failure.code === 'unsupported') return;
        /*
         * Only a `save.restore` dispatch answers `save_unsupported`, so this is a Load the build cannot read, not a
         * broken frame: report it to the pause dialog and leave the game running.
         */
        if (failure.code === 'save_unsupported') {
          for (const callback of saveLoadErrors) callback(failure.message);
          return;
        }
        clearLoadStall();
        current = { ...current, bridgeState: 'error', error: failure.message, errorCode: failure.code };
        publish();
      },
    });
  } catch (error) {
    window.removeEventListener('message', observeOrigin);
    throw error;
  }

  const finishPlacement = (result: PlacementResult) => {
    const request = activePlacement;
    if (request === undefined) return;
    clearTimeout(request.timer);
    activePlacement = undefined;
    if (!request.settled) request.resolve(result);
    sendNextPlacement();
  };
  const sendNextPlacement = () => {
    if (disposed || activePlacement !== undefined) return;
    const request = placementQueue.shift();
    if (request === undefined) return;
    const timer = setTimeout(() => {
      if (activePlacement === undefined || activePlacement.resolve !== request.resolve) return;
      activePlacement.settled = true;
      request.resolve({ ok: false, reason: 'Placement validation timed out.' });
    }, request.timeoutMs);
    activePlacement = { ...request, timer, settled: false };
    frame.send('editor.validatePlacement', { prefab: request.prefab, pose: request.pose });
  };
  stopPlacement = frame.on('editor.placement', finishPlacement);
  const stopRoomMessages = (['net.input', 'net.snapshot', 'net.event'] as const).map((type) =>
    frame.on(type, (payload) => emitRoomMessage(type, payload)),
  );

  return {
    state: snapshot,
    setMode: (mode) => frame.setMode(mode),
    setSettings: (settings) => frame.setSettings(settings),
    applyDesign: (rev, doc, patches) => {
      frame.send('design.apply', { rev, doc, patches: [...patches] });
    },
    pick: (x, y) => {
      frame.send('editor.pick', { x, y });
    },
    select: (ids) => {
      frame.send('editor.select', { ids: [...ids] });
    },
    camera: (mode, target) => {
      frame.send('editor.camera', target === undefined ? { mode } : { mode, target });
    },
    validatePlacement: (prefab, pose, timeoutMs = 3_000) =>
      new Promise((resolve) => {
        placementQueue.push({ prefab, pose, timeoutMs, resolve });
        sendNextPlacement();
      }),
    onPicked: (callback) => frame.on('editor.picked', ({ targets }) => callback(targets)),
    onScreen: (callback) => frame.on('editor.screen', callback),
    pause: () => {
      frame.send('lifecycle.pause', {});
    },
    resume: () => {
      frame.send('lifecycle.resume', {});
    },
    restoreSave: (save) => {
      frame.send('save.restore', save);
    },
    onSaveLoadError: (callback) => {
      saveLoadErrors.add(callback);
      return () => saveLoadErrors.delete(callback);
    },
    sendRoomMessage: (envelope) => {
      const parsed = hostToGameSchema.safeParse(envelope);
      if (!parsed.success || parsed.data.t === 'hello') return;
      const message = parsed.data;
      const send = frame.send as (type: Exclude<HostToGame['t'], 'hello'>, payload: unknown) => void;
      send(message.t, message.payload);
    },
    netInfo: (timeoutMs = 1_000) =>
      new Promise((resolve) => {
        if (disposed) {
          resolve(undefined);
          return;
        }
        if (frame.request === undefined) {
          resolve(undefined);
          return;
        }
        const timer = setTimeout(() => resolve(undefined), timeoutMs);
        void frame
          .request('test.renderInfo', {})
          .then((reply: unknown) => {
            clearTimeout(timer);
            resolve(reply);
          })
          .catch(() => {
            clearTimeout(timer);
            resolve(undefined);
          });
      }),
    onSaveWrite: (callback) => frame.on('save.write', callback),
    onEvent: (callback) => frame.on('event', ({ kind, payload }) => callback(kind, payload)),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearLoadStall();
      saveLoadErrors.clear();
      window.removeEventListener('message', observeOrigin);
      stopPlacement();
      for (const stop of stopRoomMessages) stop();
      if (activePlacement !== undefined) {
        clearTimeout(activePlacement.timer);
        if (!activePlacement.settled) activePlacement.resolve({ ok: false, reason: 'Game closed.' });
        activePlacement = undefined;
      }
      for (const request of placementQueue.splice(0)) {
        request.resolve({ ok: false, reason: 'Game closed.' });
      }
      frame.dispose();
    },
  };
}
