import type { ActionFrame, GmTestHooks, ViewId } from '@ogm/contracts';
import type { Frame, Page } from 'playwright';

type Probe = { renderAt: boolean; advanceTime: boolean; frameAlias: boolean };

type GameText = ReturnType<GmTestHooks['renderGameToText']>;
export type RenderInfo = Partial<ReturnType<GmTestHooks['renderInfo']>>;

/**
 * Typed access to OGM-020's `GmTestHooks` on `window.__gm` (T04 §4). Never defines hooks: it only calls what the
 * page exposes, using the `window.__frame(t)` alias when `__gm` is absent and `advanceTime` deltas when the page has
 * no `renderAt` (then `exact` is false and the report lists "exact frame times" as unchecked).
 */
export class HookDriver {
  private clockMs = 0;

  private constructor(
    /** The page a still or a clip is taken of: the whole app shell when the game runs inside it. */
    readonly page: Page,
    /** Where the game's hooks and canvas live: the page, or the game's frame inside the app shell. */
    readonly game: Page | Frame,
    private readonly probe: Probe,
    private readonly rig: ViewId | undefined,
  ) {}

  /** Render passes per frame: a follow camera needs a second pass to settle (look.mjs). */
  get passes(): number {
    return this.rig === 'follow' ? 2 : 1;
  }

  static async attach(page: Page, rig?: ViewId, game: Page | Frame = page): Promise<HookDriver> {
    const probe = await game.evaluate((): Probe => {
      const w = window as unknown as { __gm?: Record<string, unknown>; __frame?: unknown };
      return {
        renderAt: typeof w.__gm?.renderAt === 'function',
        advanceTime: typeof w.__gm?.advanceTime === 'function',
        frameAlias: typeof w.__frame === 'function',
      };
    });
    if (!probe.renderAt && !probe.advanceTime && !probe.frameAlias)
      throw new Error('page exposes no window.__gm.renderAt, advanceTime or __frame hook');
    return new HookDriver(page, game, probe, rig);
  }

  /** True when frames land on exact times (`renderAt` or the `__frame` alias). */
  get exact(): boolean {
    return this.probe.renderAt || !this.probe.advanceTime;
  }

  /** Draws the frame at absolute game time `ms`; twice for a follow camera so it settles (look.mjs). */
  async renderAt(ms: number): Promise<void> {
    for (let i = 0; i < this.passes; i += 1) {
      if (this.probe.renderAt) await this.game.evaluate((t) => (window as unknown as GmWindow).__gm.renderAt(t), ms);
      else if (this.probe.advanceTime) {
        if (ms > this.clockMs) await this.advanceTime(ms - this.clockMs);
      } else await this.game.evaluate((t) => (window as unknown as GmWindow).__frame(t / 1000), ms);
    }
    this.clockMs = Math.max(this.clockMs, ms);
  }

  async advanceTime(ms: number): Promise<void> {
    await this.game.evaluate((t) => (window as unknown as GmWindow).__gm.advanceTime(t), ms);
    this.clockMs += ms;
  }

  async inject(frame: ActionFrame): Promise<void> {
    await this.game.evaluate((f) => (window as unknown as GmWindow).__gm.inject(f), frame);
  }

  async setSeed(seed: number): Promise<void> {
    await this.game.evaluate((value) => (window as unknown as GmWindow).__gm.setSeed(value), seed);
  }

  async restore(state: unknown): Promise<void> {
    const restored = await this.game.evaluate((value) => {
      const gm = (window as unknown as { __gm?: { restore?: (save: unknown) => void } }).__gm;
      if (typeof gm?.restore !== 'function') return false;
      gm.restore({ saveSchemaVersion: 1, data: value });
      return true;
    }, state);
    if (!restored) throw new Error('page exposes no window.__gm.restore hook');
  }

  async text(): Promise<GameText | null> {
    return this.game.evaluate(() => {
      const gm = (window as unknown as Partial<GmWindow>).__gm;
      return typeof gm?.renderGameToText === 'function' ? gm.renderGameToText() : null;
    });
  }

  async info(): Promise<RenderInfo | null> {
    return this.game.evaluate(() => {
      const gm = (window as unknown as Partial<GmWindow>).__gm;
      return typeof gm?.renderInfo === 'function' ? gm.renderInfo() : null;
    });
  }

  /** `probes()` when the page has it, else the top-level numbers, strings and booleans of the text state. */
  async probes(): Promise<Record<string, number | string | boolean>> {
    const direct = await this.game.evaluate(() => {
      const gm = (window as unknown as Partial<GmWindow>).__gm;
      return typeof gm?.probes === 'function' ? gm.probes() : null;
    });
    const source = direct ?? (await this.text())?.state;
    const probes: Record<string, number | string | boolean> = {};
    if (source && typeof source === 'object') {
      for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') probes[key] = value;
      }
    }
    return probes;
  }
}

type GmWindow = { __gm: GmTestHooks; __frame(t: number): void };
