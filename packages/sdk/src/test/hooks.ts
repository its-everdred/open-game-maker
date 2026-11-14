import type { ActionFrame, GameManifest, GmTestHooks, SaveData } from '@ogm/contracts';

import { STEP_MS } from '../core/clock.js';
import type { RuntimeImpl, RuntimeRenderInfo } from '../core/runtime.js';
import type { RngState } from '../core/rng.js';

const TEXT_LIMIT = 65_536;
const KEYFRAME_TICKS = 60;
const BUNDLE_FRAME_TICKS = 30 * 60;
const BUNDLE_KEYFRAME_TICKS = 10 * 60;

interface Keyframe<S> {
  tick: number;
  rng: RngState;
  save: SaveData<S>;
}

export interface GameTextSnapshot {
  coords: string;
  tick: number;
  mode: 'play' | 'edit';
  state: unknown;
  players: unknown[];
  net: { role: 'host' | 'peer'; localPlayerIndex: number; players: number[] };
  truncated?: boolean;
}

export interface BugBundle {
  frames: { tick: number; frame: ActionFrame }[];
  keyframes: { tick: number; text: GameTextSnapshot }[];
}

export interface RuntimeHooks extends GmTestHooks {
  renderGameToText(): GameTextSnapshot;
  renderInfo(): RuntimeRenderInfo;
  bundle(): BugBundle;
  restore(save: SaveData<unknown>): void;
}

export class SdkHooks<D, S> implements RuntimeHooks {
  private readyValue = false;
  private readySet = false;

  get ready(): boolean {
    return this.readyValue;
  }

  set ready(value: boolean) {
    const explicit = this.readySet;
    this.readySet = true;
    this.readyValue = value;
    // The first assignment belongs to SDK boot. A later true is the game's
    // signal that its own assets and first frame are ready, including in a published build.
    if (value && explicit && typeof window !== 'undefined') window.dispatchEvent(new Event('gm-frame-ready'));
  }
  readonly marks: [string, number][];
  private readonly frames: { tick: number; frame: ActionFrame }[] = [];
  private readonly inputHistory: { tick: number; frame: ActionFrame }[] = [];
  private readonly keyframes: Keyframe<S>[] = [];
  private readonly textKeyframes: { tick: number; text: GameTextSnapshot }[] = [];
  private replaying = false;

  constructor(
    private readonly runtime: RuntimeImpl<D, S>,
    private readonly manifest: GameManifest,
    marks: [string, number][],
  ) {
    this.marks = marks;
    this.captureKeyframe();
    this.runtime.onStep((_dt, frames) => {
      if (!this.replaying) {
        for (const frame of frames) {
          const recorded = { tick: this.runtime.clock.tick, frame: structuredClone(frame) };
          this.frames.push(recorded);
          this.inputHistory.push(recorded);
        }
      }
      const oldestTick = this.runtime.clock.tick - BUNDLE_FRAME_TICKS;
      while (this.frames[0] && this.frames[0].tick < oldestTick) this.frames.shift();
      if (this.runtime.clock.tick % KEYFRAME_TICKS === 0) this.captureKeyframe();
      if (this.runtime.clock.tick % BUNDLE_KEYFRAME_TICKS === 0) {
        this.textKeyframes.push({ tick: this.runtime.clock.tick, text: this.renderGameToText() });
        while (this.textKeyframes.length > 4) this.textKeyframes.shift();
      }
      this.pruneRewindHistory();
    });
  }

  advanceTime(ms: number): void {
    this.runtime.advance(ms);
  }

  renderAt(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('render time must be a non-negative finite number');
    const targetTick = Math.floor((ms + 1e-9) / STEP_MS);
    const oldestKeyframe = this.keyframes[0];
    if (targetTick < this.runtime.clock.tick && oldestKeyframe && targetTick < oldestKeyframe.tick) {
      throw new RangeError('render time predates retained rewind history');
    }

    const wasPaused = this.runtime.clock.paused;
    if (wasPaused) this.runtime.clock.resume();
    try {
      if (targetTick < this.runtime.clock.tick) {
        let index = -1;
        for (let candidate = this.keyframes.length - 1; candidate >= 0; candidate -= 1) {
          if (this.keyframes[candidate]!.tick <= targetTick) {
            index = candidate;
            break;
          }
        }
        if (index < 0) index = 0;
        const keyframe = this.keyframes[index]!;
        this.runtime.instance.restore(structuredClone(keyframe.save));
        this.runtime.rng.restore(keyframe.rng);
        this.runtime.clock.reset(keyframe.tick);
        this.keyframes.splice(index + 1);

        const replayFrames = this.inputHistory.filter(({ tick }) => tick > keyframe.tick && tick <= targetTick);
        let frameIndex = 0;
        this.replaying = true;
        this.runtime.setInputReplay(true);
        try {
          while (this.runtime.clock.tick < targetTick) {
            const nextTick = this.runtime.clock.tick + 1;
            while (replayFrames[frameIndex]?.tick === nextTick) {
              this.runtime.inject(structuredClone(replayFrames[frameIndex]!.frame));
              frameIndex += 1;
            }
            this.runtime.advance(STEP_MS, false);
          }
        } finally {
          this.runtime.setInputReplay(false);
          this.replaying = false;
        }
        this.truncateTimeline(targetTick);
      }
      const remainingMs = Math.max(0, ms - this.runtime.clock.elapsedMs);
      this.runtime.advance(remainingMs, false);
      if (wasPaused) this.runtime.clock.pause();
      this.runtime.render();
    } finally {
      if (wasPaused) this.runtime.clock.pause();
    }
  }

  renderGameToText(): GameTextSnapshot {
    const snapshot: GameTextSnapshot = {
      coords:
        this.manifest.dimension === '2d'
          ? '2d grid, x right, y down, cells'
          : '3d world, x right, y up, z toward camera, metres',
      tick: this.runtime.clock.tick,
      mode: this.runtime.mode,
      state: structuredClone(this.runtime.instance.serialize().data),
      players: structuredClone(this.runtime.players),
      net: {
        role: this.runtime.net.role,
        localPlayerIndex: this.runtime.net.localPlayerIndex,
        players: this.runtime.net.players.map(({ playerIndex }) => playerIndex),
      },
    };
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= TEXT_LIMIT) return snapshot;

    return {
      ...snapshot,
      state: { truncated: true },
      players: [],
      truncated: true,
    };
  }

  restore(save: SaveData<unknown>): void {
    this.runtime.instance.restore(structuredClone(save) as SaveData<S>);
    // History before the restore no longer leads to this state; rewinding past it must fail rather than replay it.
    for (const history of [this.frames, this.inputHistory, this.keyframes, this.textKeyframes]) history.length = 0;
    this.captureKeyframe();
  }

  renderInfo(): RuntimeRenderInfo {
    return this.runtime.renderInfo();
  }

  hitTest(nx: number, ny: number): boolean {
    return (this.runtime.instance.pick?.(nx, ny) ?? []).length > 0;
  }

  setSeed(seed: number): void {
    this.runtime.rng.setSeed(seed);
  }

  inject(frame: ActionFrame): void {
    this.runtime.inject(frame);
  }

  probes(): Record<string, number | string | boolean> {
    const instance = this.runtime.instance as typeof this.runtime.instance & {
      probes?: () => Record<string, number | string | boolean>;
    };
    return {
      ...(instance.probes?.() ?? {}),
      tick: this.runtime.clock.tick,
      paused: this.runtime.clock.paused,
    };
  }

  events(since: number): ReturnType<GmTestHooks['events']> {
    return this.runtime.events.since(since);
  }

  seed(): number {
    return this.runtime.rng.seed();
  }

  bundle(): BugBundle {
    return {
      frames: structuredClone(this.frames),
      keyframes: structuredClone(this.textKeyframes),
    };
  }

  private captureKeyframe(): void {
    this.keyframes.push({
      tick: this.runtime.clock.tick,
      rng: this.runtime.rng.snapshot(),
      save: structuredClone(this.runtime.instance.serialize()),
    });
  }

  private truncateTimeline(targetTick: number): void {
    for (const timeline of [this.inputHistory, this.frames, this.textKeyframes]) {
      const firstFuture = timeline.findIndex(({ tick }) => tick > targetTick);
      if (firstFuture >= 0) timeline.splice(firstFuture);
    }
  }

  private pruneRewindHistory(): void {
    const oldestTick = Math.max(0, this.runtime.clock.tick - BUNDLE_FRAME_TICKS);
    while (this.keyframes.length > 1 && this.keyframes[1]!.tick <= oldestTick) this.keyframes.shift();
    const retainedFrom = this.keyframes[0]?.tick ?? oldestTick;
    while (this.inputHistory[0] && this.inputHistory[0].tick <= retainedFrom) this.inputHistory.shift();
  }
}
