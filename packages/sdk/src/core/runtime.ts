import type { ActionFrame, GameInstance, GmTestHooks, HostApi } from '@ogm/contracts';

import { FixedClock, type Clock, type StepListener } from './clock.js';
import { EventRing } from './events.js';
import type { SdkHostApi } from './host-api.js';
import { SeededRng, type Rng } from './rng.js';
import type { LoadMessage, LoadSender } from '../assets/cache.js';
import type { RuntimeHooks } from '../test/hooks.js';
import { InputMerger, type InputMergerOptions } from '../input/merger.js';
import type { GmNet, NetController, NetDiagnostics, NetPlayer } from '../net/index.js';

export type BuildKind = 'draft' | 'test' | 'published';
export type GameMode = 'play' | 'edit';
export type RenderInfo = ReturnType<GmTestHooks['renderInfo']>;
export type RuntimeRenderInfo = RenderInfo & { net: NetDiagnostics };

export interface Runtime<D, S> {
  readonly instance: GameInstance<D, S>;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly hooks: RuntimeHooks;
  readonly net: GmNet;
  readonly host: HostApi;
  readonly build: BuildKind;
  readonly mode: GameMode;
  readonly localPlayerIndex: number;
  readonly send: LoadSender;
  onFrame(callback: (dt: number) => void): () => void;
  onStep(callback: StepListener): () => void;
  onNet(callback: (type: string, payload: unknown) => void): () => void;
  attachInput(options: RuntimeInputOptions): InputMerger;
  setRenderInfoProvider(provider: () => RenderInfo): void;
  dispose(): void;
}

export type RuntimeInputOptions = Omit<InputMergerOptions, 'bridge' | 'localPlayerIndex'> & {
  localPlayerIndex?: number;
};

const zeroRenderInfo = (): RenderInfo => ({
  calls: 0,
  triangles: 0,
  frameMs: 0,
  textureBytes: 0,
  backend: 'headless',
});

export class RuntimeImpl<D, S> implements Runtime<D, S> {
  readonly clock: FixedClock;
  readonly rng: SeededRng;
  hooks!: RuntimeHooks;
  net!: GmNet;
  readonly players: NetPlayer[] = [];
  private currentMode: GameMode;
  private readonly frameListeners = new Set<(dt: number) => void>();
  private readonly stepListeners = new Set<StepListener>();
  private readonly netListeners = new Set<(type: string, payload: unknown) => void>();
  private readonly cleanupCallbacks = new Set<() => void>();
  private renderInfoProvider: () => RenderInfo = zeroRenderInfo;
  private liveFrame: number | undefined;
  private lastFrameMs: number | undefined;
  private inputMerger: InputMerger | undefined;
  private keyboardBindings: Record<string, string> | undefined;
  private defaultKeyboardBindings: Record<string, string> = {};
  private replayingInput = false;
  private currentLocalPlayerIndex = 0;
  private readonly pendingHostFrames: ActionFrame[] = [];
  private netController: NetController | undefined;
  private sender: ((type: LoadMessage['t'], payload: LoadMessage['payload']) => void) | undefined;
  private disposed = false;
  readonly send: LoadSender = (type, payload) => {
    if (!this.sender) throw new Error('runtime sender is unavailable');
    this.sender(type, payload);
  };

  constructor(
    readonly instance: GameInstance<D, S>,
    readonly host: SdkHostApi,
    readonly build: BuildKind,
    mode: GameMode,
    readonly events: EventRing,
    private readonly closeBridge: () => void,
    clock = new FixedClock(),
    rng = new SeededRng(),
  ) {
    this.clock = clock;
    this.rng = rng;
    this.currentMode = mode;
    this.cleanupCallbacks.add(
      host.settings.onChange((settings) => {
        if (JSON.stringify(this.keyboardBindings) === JSON.stringify(settings.keyboardBindings)) return;
        this.keyboardBindings = settings.keyboardBindings;
        this.inputMerger?.setKeyboardMapping(this.keyboardBindings ?? this.defaultKeyboardBindings);
      }),
    );
    this.clock.onStep((_dt, frames) => {
      if (this.inputMerger && !this.replayingInput) {
        for (const frame of this.pendingHostFrames.splice(0)) this.inputMerger.acceptHostFrame(frame);
        for (const frame of frames.splice(0)) this.inputMerger.inject(frame);
        frames.push(...this.inputMerger.sample(this.clock.tick));
      } else if (!this.replayingInput) {
        frames.push(...this.pendingHostFrames.splice(0));
      }
      this.netController?.beforeStep(this.clock.tick, frames);
      if (this.netController && !this.netController.stepLocally) {
        this.netController.handleLocalFrames(frames);
        return;
      }
      this.host.dispatchInput(frames);
      for (const listener of this.stepListeners) listener(this.clock.dt, frames);
      this.netController?.afterStep(this.clock.tick);
    });
  }

  get mode(): GameMode {
    return this.currentMode;
  }

  get localPlayerIndex(): number {
    return this.currentLocalPlayerIndex;
  }

  attachSender(send: (type: LoadMessage['t'], payload: LoadMessage['payload']) => void): void {
    this.sender = send;
  }

  attachHooks(hooks: RuntimeHooks): void {
    this.hooks = hooks;
  }

  setMode(mode: GameMode): void {
    this.currentMode = mode;
  }

  onFrame(callback: (dt: number) => void): () => void {
    this.frameListeners.add(callback);
    return () => this.frameListeners.delete(callback);
  }

  onStep(callback: StepListener): () => void {
    this.stepListeners.add(callback);
    return () => this.stepListeners.delete(callback);
  }

  onNet(callback: (type: string, payload: unknown) => void): () => void {
    this.netListeners.add(callback);
    return () => this.netListeners.delete(callback);
  }

  attachInput(options: RuntimeInputOptions): InputMerger {
    this.inputMerger?.dispose();
    const merger = new InputMerger({
      ...options,
      localPlayerIndex: options.localPlayerIndex ?? this.currentLocalPlayerIndex,
      bridge: {
        send: (_type, payload) => this.host.sendRawKey(payload),
      },
    });
    this.inputMerger = merger;
    this.defaultKeyboardBindings = { ...options.mapping.keyboard };
    if (this.keyboardBindings) merger.setKeyboardMapping(this.keyboardBindings);
    return merger;
  }

  acceptHostFrame(frame: ActionFrame): void {
    this.pendingHostFrames.push(frame);
  }

  setLocalPlayerIndex(playerIndex: number): void {
    this.currentLocalPlayerIndex = playerIndex;
    this.inputMerger?.setLocalPlayerIndex(playerIndex);
  }

  setPlayers(players: ReadonlyArray<NetPlayer>): void {
    this.players.splice(0, this.players.length, ...structuredClone(players));
  }

  installNet(controller: NetController): void {
    this.netController?.dispose();
    this.netController = controller;
    this.net = controller.net;
  }

  handleNet(type: string, payload: unknown): void {
    this.netController?.handleMessage(type, payload);
    this.emitNet(type, payload);
  }

  setInputReplay(replaying: boolean): void {
    this.replayingInput = replaying;
  }

  emitNet(type: string, payload: unknown): void {
    for (const listener of this.netListeners) listener(type, payload);
  }

  inject(frame: ActionFrame): void {
    this.clock.inject(frame);
  }

  advance(ms: number, render = true): number {
    // A paused clock produces no steps and therefore no render, so the start gate is evaluated before it moves.
    this.netController?.gate();
    const steps = this.clock.advance(ms);
    if (render && steps > 0) this.render();
    return steps;
  }

  render(): void {
    this.netController?.gate();
    this.netController?.render();
    for (const listener of this.frameListeners) listener(this.clock.dt);
  }

  setRenderInfoProvider(provider: () => RenderInfo): void {
    this.renderInfoProvider = provider;
  }

  renderInfo(): RuntimeRenderInfo {
    return {
      ...this.renderInfoProvider(),
      net: { ...(this.netController?.diagnostics ?? zeroNetDiagnostics()) },
    };
  }

  addCleanup(callback: () => void): void {
    this.cleanupCallbacks.add(callback);
  }

  startLiveLoop(): void {
    if (typeof requestAnimationFrame !== 'function' || this.liveFrame !== undefined) return;
    const frame = (nowMs: number) => {
      if (this.disposed) return;
      if (this.lastFrameMs === undefined) this.lastFrameMs = nowMs;
      const elapsed = Math.min(50, Math.max(0, nowMs - this.lastFrameMs));
      this.lastFrameMs = nowMs;
      this.clock.advance(elapsed);
      this.render();
      this.liveFrame = requestAnimationFrame(frame);
    };
    this.liveFrame = requestAnimationFrame(frame);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.liveFrame !== undefined && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(this.liveFrame);
    this.liveFrame = undefined;
    this.clock.pause();

    let firstFailure: unknown;
    let failed = false;
    const attempt = (callback: () => void) => {
      try {
        callback();
      } catch (error) {
        if (failed) return;
        failed = true;
        firstFailure = error;
      }
    };

    attempt(() => this.instance.dispose());
    attempt(() => this.inputMerger?.dispose());
    this.inputMerger = undefined;
    this.pendingHostFrames.length = 0;
    attempt(() => this.netController?.dispose());
    this.netController = undefined;
    this.stepListeners.clear();
    for (const cleanup of this.cleanupCallbacks) attempt(cleanup);
    this.cleanupCallbacks.clear();
    attempt(this.closeBridge);
    if (failed) throw firstFailure;
  }
}

function zeroNetDiagnostics(): NetDiagnostics {
  return {
    mode: 'host',
    epoch: '',
    tick: 0,
    lateStartTicks: 0,
    inputDelayTicks: 0,
    inputGaps: 0,
    lateInputs: 0,
    localResponseMs: 0,
    remoteUpdateMs: 0,
    clockOffsetMs: 0,
    clockResyncs: 0,
    desyncs: 0,
    recoveries: 0,
    hardResyncs: 0,
    desynced: false,
    dropped: 0,
    eventGaps: 0,
    outOfOrderSnapshots: 0,
    stalls: 0,
    oversized: 0,
    eventDelayMs: 0,
    eventDelayP95Ms: 0,
    droppedBytes: 0,
  };
}
