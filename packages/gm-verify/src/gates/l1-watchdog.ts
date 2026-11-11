import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { OpenedGame } from '../browser.js';

const STALL_MS = 90_000;
const PROGRESS_MS = 10_000;

/** Bounds all asynchronous stages, including startup and cleanup. */
export class L1Watchdog {
  private reject!: (error: Error) => void;
  private readonly stopped: Promise<never>;
  private readonly deadline: ReturnType<typeof setTimeout>;
  private readonly progress: ReturnType<typeof setInterval>;
  private stall?: ReturnType<typeof setTimeout>;
  private failure?: Error;
  readonly controller = new AbortController();
  private tick = 0;
  private stage = 'starting';
  private readonly onInterrupt = () => this.fail('interrupted by SIGINT');
  private readonly onTerminate = () => this.fail('interrupted by SIGTERM');
  readonly endAt: number;

  constructor(
    private readonly total: number,
    deadlineMs: number,
    private readonly output?: (line: string) => void,
    private readonly onFailure?: (reason: string) => void,
    private readonly stallMs = STALL_MS,
  ) {
    this.endAt = Date.now() + deadlineMs;
    this.stopped = new Promise<never>((_, reject) => {
      this.reject = reject;
    });
    // A timer can fire between operations; retain a handler until the next race.
    void this.stopped.catch(() => {});
    this.deadline = setTimeout(() => this.fail(`deadline exceeded during ${this.stage}`), deadlineMs);
    this.progress = setInterval(() => this.output?.(`tick ${this.tick}/${this.total} (${this.stage})`), PROGRESS_MS);
    process.on('SIGINT', this.onInterrupt);
    process.on('SIGTERM', this.onTerminate);
  }

  fail(reason: string): void {
    if (this.failure) return;
    this.failure = new Error(`stalled at tick ${this.tick}: ${reason}`);
    this.onFailure?.(this.failure.message);
    this.reject(this.failure);
    this.controller.abort();
  }

  async wait<T>(promise: Promise<T>, late?: (value: T) => void): Promise<T> {
    if (this.failure) throw this.failure;
    if (late)
      void promise.then(
        (value) => {
          if (this.failure) late(value);
        },
        () => {},
      );
    return Promise.race([promise, this.stopped]);
  }

  setStage(stage: string): void {
    this.stage = stage;
  }
  startTicks(): void {
    this.setStage('advancing ticks');
    this.resetStall();
  }
  progressed(tick: number): void {
    if (tick > this.tick) {
      this.tick = tick;
      this.resetStall();
    }
  }
  endTicks(): void {
    if (this.stall) clearTimeout(this.stall);
    this.stall = undefined;
  }
  private resetStall(): void {
    if (this.stall) clearTimeout(this.stall);
    this.stall = setTimeout(() => this.fail(`no tick progress for ${this.stallMs / 1_000} seconds`), this.stallMs);
  }
  close(): void {
    clearTimeout(this.deadline);
    clearInterval(this.progress);
    this.endTicks();
    process.off('SIGINT', this.onInterrupt);
    process.off('SIGTERM', this.onTerminate);
  }
}

/** Best effort only: a hung page must not prevent the watchdog from returning. */
export async function writeStallDiagnostic(
  outDir: string,
  game: OpenedGame | undefined,
  reason: string,
): Promise<void> {
  const diagnostic: Record<string, unknown> = { reason, console: game?.console.list() ?? [] };
  if (game) {
    await Promise.race([
      Promise.allSettled([
        game.page.screenshot({ path: join(outDir, 'stall.png'), timeout: 1_000 }),
        game.hooks.text().then((state) => {
          diagnostic.pageState = state;
        }),
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
  }
  writeFileSync(join(outDir, 'stall.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
}
