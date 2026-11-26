import { createGameFrame, type GameFrame, type GameFrameOptions, type GameLoadEvent } from '@gm/host';
import type {
  DesignDoc,
  Envelope,
  GameFault,
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

type FrameLike = Pick<GameFrame, 'dispose' | 'on' | 'send' | 'setMode' | 'setSettings' | 'restoreSave'> & {
  bridge: Pick<GameFrame['bridge'], 'dropped'>;
  /** Optional so a test double need not answer diagnostics; `netInfo()` reports `undefined` when it cannot ask. */
  request?: GameFrame['request'];
  project?: GameFrame['project'];
  pick?: GameFrame['pick'];
};

export type GameLoadProgress = Extract<GameLoadEvent, { t: 'load.progress' }>['payload'];
export type GameLoadDone = Extract<GameLoadEvent, { t: 'load.done' }>['payload'];

/** The running scene's HD-2D as the game last reported it (`hd2d.scene`); `doc` is `null` when it has none. */
export type Hd2dReport = Extract<GameToHost, { t: 'hd2d.scene' }>['payload'];

export type GameLoadMeasurement = Pick<GameLoadDone, 'ms' | 'fetchedBytes' | 'cachedBytes'>;
export type GameFrameState = {
  bridgeState: 'connecting' | 'ready' | 'error';
  dropped: number;
  manifest?: GameManifest;
  error?: string;
  errorCode?: string;
  /** Do not write over an existing save after startup restore failed. */
  startupSaveError?: boolean;
  /** Older builds cannot confirm a manual restore, so recovery requires a rebuilt game. */
  startupRecoveryUnavailable?: boolean;
  firstFrame?: boolean;
  load?: Pick<GameLoadProgress, 'phase' | 'loaded' | 'total'> & { done: boolean };
  /** The game's latest `host.pause.visible`; unset means visible, and a remount starts unset. */
  hostPauseVisible?: boolean;
  /** Unset until the game reports; a game without the SDK's HD-2D never does. */
  hd2d?: Hd2dReport;
};

/** The game hides the host Pause control only in play, while its bridge is up; any failure shows it again. */
export function hidesHostPause(mode: 'play' | 'edit', state: Pick<GameFrameState, 'bridgeState' | 'hostPauseVisible'>) {
  return mode === 'play' && state.bridgeState === 'ready' && state.hostPauseVisible === false;
}

export type GameFrameController = {
  state(): GameFrameState;
  setMode(mode: 'play' | 'edit'): void;
  setSettings(settings: PlayerSettings): void;
  applyDesign(rev: number, doc: DesignDoc, patches: readonly Patch[]): void;
  pick(x: number, y: number): void;
  pickAt(x: number, y: number): Promise<TargetRef[]>;
  project(x: number, y: number, prefab?: string): Promise<[number, number, number] | null>;
  select(ids: readonly string[]): void;
  camera(mode: 'follow' | 'free', target?: string): void;
  /** Re-renders the running scene from an edited HD-2D document; absent where no game runs (previews). */
  applyHd2d?(doc: unknown, weather?: string): void;
  validatePlacement(prefab: string, pose: Pose, timeoutMs?: number): Promise<PlacementResult>;
  onPicked(callback: (targets: TargetRef[]) => void): () => void;
  onScreen(
    callback: (position: { id: string; x: number; y: number } | { id: string; offscreen: true }) => void,
  ): () => void;
  pause(): void;
  resume(): void;
  restoreSave(save: SaveData<unknown>): Promise<SaveData<unknown>>;
  confirmSaveRecovery(): void;
  /**
   * A `save.restore` the running build refused, as a failed Load rather than a frame error. The game keeps running.
   */
  onSaveLoadError(callback: (message: string) => void): () => void;
  sendRoomMessage(envelope: Envelope<string, unknown>): void;
  onSaveWrite(callback: (save: SaveData<unknown>) => void): () => void;
  /** Observe live writes without consuming the startup replay reserved for persistence. */
  observeSaveWrite?(callback: (save: SaveData<unknown>) => void): () => void;
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
  preview?: boolean;
  authenticated?: boolean;
  mode: 'play' | 'edit';
  design: { rev: number; doc: DesignDoc };
  build?: 'draft' | 'test' | 'published';
  /** Query parameters the game boots with: a review deck's playable scenario (#608). */
  params?: Readonly<Record<string, string>>;
  /** Load an initial save while a compatible SDK holds simulation. */
  startupRestore?(manifest: GameManifest): Promise<SaveData<unknown> | undefined>;
  onStartupRestoreError?(error: unknown): void;
  resumeAfterStartup?(): boolean;
  create?(options: GameFrameOptions): FrameLike;
  onState?(state: GameFrameState): void;
  onSaveWrite?(payload: { saveSchemaVersion: number; data: unknown }): void;
  onEvent?(kind: 'achievement' | 'analytics' | 'checkpoint', payload: unknown): void;
  /** A non-fatal failure inside the game frame; the game keeps running. */
  onFault?(fault: GameFault): void;
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
  let firstFrameTimer: ReturnType<typeof setTimeout> | undefined;
  let expectsFirstFrame = false;
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
  let pendingStartupRestore: { resolve(): void; reject(error: Error): void } | undefined;
  const startupWrites: SaveData<unknown>[] = [];
  let saveWriteSubscribers = 0;
  let startupWriteWindow = true;
  let currentMode = options.mode;
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
  const clearFirstFrameTimer = () => {
    if (firstFrameTimer !== undefined) clearTimeout(firstFrameTimer);
    firstFrameTimer = undefined;
  };
  const armFirstFrameTimer = () => {
    clearFirstFrameTimer();
    if (!expectsFirstFrame || current.firstFrame || disposed) return;
    firstFrameTimer = setTimeout(() => {
      if (disposed || current.firstFrame || current.bridgeState === 'error') return;
      clearLoadStall();
      current = { ...current, bridgeState: 'error', error: 'first-frame-stalled', errorCode: 'first-frame-stalled' };
      publish();
    }, 20_000);
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
    if (disposed) return;
    if (current.bridgeState === 'error') {
      /*
       * A stall is a guess from silence. A game that was only busy (Blobs compiling its shaders reported nothing for
       * 20 s under load and kept "Try again" up over a running game, #1260) and then reports again is alive: recover.
       */
      if (current.errorCode !== 'load-stalled' && current.errorCode !== 'first-frame-stalled') return;
      if (current.errorCode === 'load-stalled') loadTerminal = false;
      current = { ...current, bridgeState: 'ready', error: undefined, errorCode: undefined };
    }
    if (event.t === 'load.frame') {
      clearFirstFrameTimer();
      current = { ...current, firstFrame: true };
      publish();
      return;
    }
    if (loadTerminal) return;
    if (event.t === 'load.done') {
      loadObserved = true;
      clearFirstFrameTimer();
      loadTerminal = true;
      clearLoadStall();
      const load = current.load ?? { phase: 'ready' as const, loaded: 0, total: 0, done: false };
      current = {
        ...current,
        firstFrame: current.firstFrame,
        load: { ...load, done: true },
      };
      armFirstFrameTimer();
      publish();
      options.onLoadDone?.(event.payload);
      return;
    }
    if (event.payload.phase === 'stream') return;
    loadObserved = true;
    clearFirstFrameTimer();
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
    if (
      options.preview &&
      event.origin === 'null' &&
      event.source === options.container.querySelector('iframe')?.contentWindow
    )
      return;
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
      ...(options.preview ? { preview: true } : {}),
      ...(options.authenticated ? { authenticated: true } : {}),
      build: options.build ?? 'draft',
      ...(options.params === undefined ? {} : { params: options.params }),
      mode: options.mode,
      ...(options.startupRestore ? { startupHold: true } : {}),
      playerIndex: 0,
      capabilities: [],
      role: () => 'owner',
      /*
       * The handshake waits for the game's entry module to download and run. Over Funnel from a busy host that took
       * 7-12 s for Dusk Helm (2026-11-24) and 10 s showed "Try again" before the title; slow loads after the handshake
       * have their own 20 s stall timer, so this only guards a frame that never answers.
       */
      readyTimeoutMs: 30_000,
      onReady: (manifest, marks, startupHold) => {
        if (current.bridgeState === 'error') return;
        // The games host forwards the existing game-ready event for legacy builds; new SDKs also send load.frame.
        expectsFirstFrame = true;
        frame.send('design.apply', { rev: options.design.rev, doc: options.design.doc, patches: [] });
        const finish = () => {
          if (disposed) return;
          if (startupHold && (options.resumeAfterStartup?.() ?? true)) frame.send('lifecycle.resume', {});
          current = {
            ...current,
            bridgeState: 'ready',
            manifest,
            load: loadObserved ? current.load : { phase: 'ready', loaded: 0, total: 0, done: true },
          };
          armFirstFrameTimer();
          emitRoomMessage('ready', { protocol: SDK_PROTOCOL, manifest, marks });
          publish();
        };
        if (!options.startupRestore) {
          finish();
          return;
        }
        let timer: ReturnType<typeof setTimeout>;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('save restore timed out')), 10_000);
        });
        let restoring = true;
        const restore = Promise.resolve().then(async () => {
          const save = await options.startupRestore!(manifest);
          if (!restoring || disposed || currentMode !== 'play' || !save) return;
          if (!startupHold) {
            current = { ...current, startupRecoveryUnavailable: true };
            throw new Error('game cannot hold startup');
          }
          await new Promise<void>((resolve, reject) => {
            pendingStartupRestore = { resolve, reject };
            frame.send('save.restore', save);
          });
        });
        void Promise.race([restore, deadline])
          .catch((error: unknown) => {
            if (!disposed) {
              current = {
                ...current,
                startupSaveError: true,
                ...(!startupHold ? { startupRecoveryUnavailable: true } : {}),
              };
              startupWrites.length = 0;
              startupWriteWindow = false;
              options.onStartupRestoreError?.(error);
            }
          })
          .finally(() => {
            restoring = false;
            clearTimeout(timer);
            pendingStartupRestore = undefined;
            finish();
          });
      },
      onLoad: handleLoad,
      onSaveWrite: options.onSaveWrite,
      onEvent: options.onEvent,
      onFault: options.onFault,
      onError: (failure) => {
        /* The game declined an optional command (a camera mode, selection) or an HD-2D edit, and keeps running. */
        if (failure.code === 'unsupported' || failure.code === 'hd2d_rejected') return;
        /*
         * Only a `save.restore` dispatch answers `save_unsupported`, so this is a Load the build cannot read, not a
         * broken frame: report it to the pause dialog and leave the game running.
         */
        if (failure.code === 'save_unsupported') {
          if (pendingStartupRestore) {
            pendingStartupRestore.reject(new Error(failure.message));
            pendingStartupRestore = undefined;
            return;
          }
          for (const callback of saveLoadErrors) callback(failure.message);
          return;
        }
        clearLoadStall();
        clearFirstFrameTimer();
        current = { ...current, bridgeState: 'error', error: failure.message, errorCode: failure.code };
        publish();
      },
    });
  } catch (error) {
    window.removeEventListener('message', observeOrigin);
    throw error;
  }

  const stopStartupRestore = frame.on('save.restored', () => {
    if (pendingStartupRestore) pendingStartupRestore.resolve();
    pendingStartupRestore = undefined;
  });
  const stopStartupWrites = frame.on('save.write', (save) => {
    const migration = (save as { reason?: string }).reason === 'migration';
    if (
      currentMode === 'play' &&
      (startupWriteWindow || (current.startupSaveError && migration)) &&
      saveWriteSubscribers === 0
    ) {
      if (startupWrites.length === 4) startupWrites.shift();
      startupWrites.push(save);
    }
  });
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
  const stopHostPause = frame.on('host.pause.visible', ({ visible }) => {
    if (disposed || current.hostPauseVisible === visible) return;
    current = { ...current, hostPauseVisible: visible };
    publish();
  });
  const stopHd2d = frame.on('hd2d.scene', (report) => {
    if (disposed) return;
    current = { ...current, hd2d: report };
    publish();
  });
  const stopRoomMessages = (
    [
      'net.input',
      'net.snapshot',
      'net.event',
      'net.inputs',
      'net.state',
      'net.checksum',
      'net.recovery.request',
      'net.recovery',
      'net.ready',
      'net.start.request',
      'net.pause.ack',
      'net.pause.late',
      'net.pause.position',
    ] as const
  ).map((type) => frame.on(type, (payload) => emitRoomMessage(type, payload)));

  return {
    state: snapshot,
    setMode: (mode) => {
      currentMode = mode;
      if (mode !== 'play') {
        startupWrites.length = 0;
        startupWriteWindow = false;
      }
      frame.setMode(mode);
    },
    setSettings: (settings) => frame.setSettings(settings),
    applyDesign: (rev, doc, patches) => {
      frame.send('design.apply', { rev, doc, patches: [...patches] });
    },
    pick: (x, y) => {
      frame.send('editor.pick', { x, y });
    },
    pickAt: (x, y) => frame.pick?.(x, y) ?? Promise.reject(new Error('correlated picking unavailable')),
    project: (x, y, prefab) =>
      (prefab === undefined ? frame.project?.(x, y) : frame.project?.(x, y, prefab)) ?? Promise.resolve(null),
    select: (ids) => {
      frame.send('editor.select', { ids: [...ids] });
    },
    camera: (mode, target) => {
      frame.send('editor.camera', target === undefined ? { mode } : { mode, target });
    },
    applyHd2d: (doc, weather) => {
      frame.send('hd2d.apply', weather === undefined ? { doc } : { doc, weather });
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
    restoreSave: async (save) => {
      if (!frame.restoreSave) throw new Error('Save restore unavailable');
      const restored = await frame.restoreSave(save);
      startupWrites.length = 0;
      return restored;
    },
    confirmSaveRecovery: () => {
      if (current.startupSaveError) {
        current = { ...current, startupSaveError: false };
        publish();
      }
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
    onSaveWrite: (callback) => {
      startupWriteWindow = false;
      saveWriteSubscribers += 1;
      const stop = frame.on('save.write', (save) => {
        if (currentMode === 'play') callback(save);
      });
      for (const save of startupWrites.splice(0)) callback(save);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        saveWriteSubscribers -= 1;
        stop();
      };
    },
    observeSaveWrite: (callback) =>
      frame.on('save.write', (save) => {
        if (currentMode === 'play') callback(save);
      }),
    onEvent: (callback) => frame.on('event', ({ kind, payload }) => callback(kind, payload)),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearLoadStall();
      clearFirstFrameTimer();
      saveLoadErrors.clear();
      window.removeEventListener('message', observeOrigin);
      stopStartupRestore();
      stopStartupWrites();
      stopPlacement();
      stopHostPause();
      stopHd2d();
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
