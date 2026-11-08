import { join } from 'node:path';

import type { Page } from 'playwright';

import { describeStep, fill, type ExpectStep, type Step } from './journey.js';
import { frame, isBlank, isChanged, pixelStats } from './pixels.js';

const POLL_MS = 100;
const INPUT = new Set<Step['do']>(['goto', 'click', 'tap', 'press', 'swipe']);

export type StepResult = {
  index: number;
  step: string;
  ok: boolean;
  ms: number;
  error?: string;
  /** The still taken by a `shot` step, or at an `expect` (for `gm qa look`), relative to the run directory. */
  shot?: string;
  look?: string;
  /** Milliseconds since the run's start when an expect was met; the room check compares these across clients. */
  metAt?: number;
};

/** Drives one page with real input: mouse or touch, keyboard, CDP touch swipes. */
export class Player {
  readonly vars: Record<string, string>;
  private shots = 0;
  /** The frame before the latest input (or `mark`); a `changed` expect compares against it, then clears it. */
  private before: Buffer | undefined;

  readonly label: string;
  private readonly touch: boolean;
  private readonly startedAt: number;

  constructor(
    readonly page: Page,
    readonly outDir: string,
    options: { label: string; touch: boolean; vars?: Record<string, string>; startedAt?: number },
  ) {
    this.label = options.label;
    this.touch = options.touch;
    this.vars = options.vars ?? {};
    this.startedAt = options.startedAt ?? Date.now();
  }

  private point([fx, fy]: readonly [number, number]): { x: number; y: number } {
    const size = this.page.viewportSize() ?? { width: 1280, height: 720 };
    return { x: Math.round(fx * size.width), y: Math.round(fy * size.height) };
  }

  private locator(step: { text?: string; selector?: string }) {
    if (step.selector !== undefined) return this.page.locator(fill(step.selector, this.vars)).first();
    return this.page.getByText(fill(step.text ?? '', this.vars), { exact: true }).first();
  }

  async shot(name: string): Promise<string> {
    this.shots += 1;
    const file = `${this.label}-${String(this.shots).padStart(2, '0')}-${name}.png`;
    await this.page.screenshot({ path: join(this.outDir, file) });
    return file;
  }

  /** Takes the frame a later `changed` expect compares against, for a page that waits on someone else's input. */
  async mark(): Promise<void> {
    this.before = await frame(this.page);
  }

  /** Waits until the expect holds; throws with what was missing after `timeoutMs`. */
  async expect(step: ExpectStep): Promise<number> {
    const deadline = Date.now() + step.timeoutMs;
    const before = step.pixels === 'changed' ? (this.before ?? (await frame(this.page))) : undefined;
    if (step.pixels === 'changed') this.before = undefined;
    const text = step.text !== undefined ? fill(step.text, this.vars) : undefined;
    for (;;) {
      let missing = '';
      if (text !== undefined) {
        const body = await this.page.evaluate(() => document.body?.innerText ?? '');
        if (!body.includes(text)) missing = `text "${text}"`;
      }
      if (!missing && step.pixels) {
        const stats = await pixelStats(this.page, await frame(this.page), before, step.region);
        if (step.pixels === 'nonblank' && isBlank(stats)) missing = 'non-blank pixels';
        if (step.pixels === 'changed' && !isChanged(stats)) missing = 'changed pixels';
      }
      if (!missing) return Date.now() - this.startedAt;
      if (Date.now() >= deadline) throw new Error(`missing ${missing} after ${step.timeoutMs}ms`);
      await this.page.waitForTimeout(POLL_MS);
    }
  }

  async swipe(from: readonly [number, number], to: readonly [number, number], ms: number): Promise<void> {
    const a = this.point(from);
    const b = this.point(to);
    const cdp = await this.page.context().newCDPSession(this.page);
    const moves = Math.max(2, Math.round(ms / 16));
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
      for (let i = 1; i <= moves; i += 1) {
        const t = i / moves;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) }],
        });
        await this.page.waitForTimeout(ms / moves);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
  }

  /** Runs one step. Never throws: a failed step comes back with `ok: false` and its error. */
  async run(step: Step, index: number): Promise<StepResult> {
    const started = Date.now();
    const result: StepResult = { index, step: describeStep(step), ok: true, ms: 0 };
    try {
      if (INPUT.has(step.do)) this.before = await frame(this.page);
      switch (step.do) {
        case 'goto':
          await this.page.goto(fill(step.url, this.vars), { waitUntil: 'load' });
          break;
        case 'click':
          await this.locator(step).click();
          break;
        case 'tap':
          if (step.at) {
            const { x, y } = this.point(step.at);
            if (this.touch) await this.page.touchscreen.tap(x, y);
            else await this.page.mouse.click(x, y);
          } else if (this.touch) await this.locator(step).tap();
          else await this.locator(step).click();
          break;
        case 'press':
          for (let i = 0; i < step.times; i += 1) {
            await this.page.keyboard.down(step.key);
            await this.page.waitForTimeout(step.holdMs);
            await this.page.keyboard.up(step.key);
          }
          break;
        case 'swipe':
          await this.swipe(step.from, step.to, step.ms);
          break;
        case 'wait':
          await this.page.waitForTimeout(step.ms);
          break;
        case 'shot':
          result.shot = await this.shot(step.name);
          break;
        case 'read':
          this.vars[step.as] = step.url
            ? this.page.url()
            : (
                await this.page
                  .locator(fill(step.selector ?? '', this.vars))
                  .first()
                  .innerText()
              ).trim();
          if (!this.vars[step.as]) throw new Error(`{${step.as}} read an empty value`);
          break;
        case 'expect':
          result.metAt = await this.expect(step);
          if (step.look) {
            result.look = step.look;
            result.shot = await this.shot(`look-${index}`);
          }
          break;
      }
    } catch (error) {
      result.ok = false;
      result.error = (error instanceof Error ? error.message : String(error)).split('\n')[0];
      if (step.do === 'expect' && step.look) result.look = step.look;
      result.shot ??= await this.shot(`fail-${index}`).catch(() => undefined);
    }
    result.ms = Date.now() - started;
    return result;
  }

  /** Runs steps in order and stops at the first failure (later steps would only report its consequences). */
  async runAll(steps: readonly Step[], offset = 0): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const [i, step] of steps.entries()) {
      const result = await this.run(step, offset + i);
      results.push(result);
      if (!result.ok) break;
    }
    return results;
  }
}
