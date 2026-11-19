import type { ActionFrame } from '@ogm/contracts';

export const FIXED_DT = 1 / 60;
export const STEP_MS = 1000 / 60;

export type StepListener = (dt: number, frames: ActionFrame[]) => void;

export interface Clock {
  readonly dt: number;
  readonly tick: number;
  readonly paused: boolean;
  advance(ms: number): number;
  pause(): void;
  resume(): void;
}

export class FixedClock implements Clock {
  readonly dt = FIXED_DT;
  private accumulatorMs = 0;
  private currentTick = 0;
  private isPaused = false;
  private readonly listeners = new Set<StepListener>();
  private readonly pendingFrames: ActionFrame[] = [];

  constructor(listener?: StepListener) {
    if (listener) this.listeners.add(listener);
  }

  get tick(): number {
    return this.currentTick;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get elapsedMs(): number {
    return this.currentTick * STEP_MS + this.accumulatorMs;
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('clock duration must be a non-negative finite number');
    if (this.isPaused) return 0;

    this.accumulatorMs += ms;
    let steps = 0;
    while (!this.isPaused && this.accumulatorMs >= STEP_MS - 1e-9) {
      this.accumulatorMs -= STEP_MS;
      this.currentTick += 1;
      steps += 1;
      const frames = this.pendingFrames.splice(0);
      for (const listener of this.listeners) listener(this.dt, frames);
    }
    if (this.isPaused) this.accumulatorMs = 0;
    return steps;
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  inject(frame: ActionFrame): void {
    this.pendingFrames.push(frame);
  }

  discardInput(): void {
    this.pendingFrames.length = 0;
  }

  onStep(listener: StepListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(tick: number, accumulatorMs = 0): void {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError('clock tick must be a non-negative integer');
    if (!Number.isFinite(accumulatorMs) || accumulatorMs < 0 || accumulatorMs >= STEP_MS) {
      throw new RangeError('clock accumulator must be within one fixed step');
    }
    this.currentTick = tick;
    this.accumulatorMs = accumulatorMs;
    this.pendingFrames.length = 0;
  }
}
