import { writeFileSync } from 'node:fs';

import type { ActionValue } from '@ogm/contracts';
import { join } from 'node:path';

import type { HookDriver } from './hooks.js';
import type { TrailerInput } from './trailer-script.js';

/** Advance in chronological order: input at a frame boundary is applied before that frame is drawn. */
export async function scriptedFrames(
  hooks: Pick<HookDriver, 'advanceTime' | 'inject'> & { click?: (selector: string) => Promise<void> },
  script: TrailerInput[],
  seconds: number,
  fps: number,
  capture: (index: number) => Promise<void>,
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(fps) || fps < 1 || fps > 60)
    throw new Error('invalid scripted recording duration or frame rate');
  const actions = [...script].sort((a, b) => a.t - b.t);
  if (actions.some((action) => !Number.isFinite(action.t) || action.t < 0 || action.t >= seconds))
    throw new Error('scripted inputs must fall within the recording');
  let now = 0;
  let next = 0;
  const stepMs = 1000 / 60;
  const held = new Map<number, Record<string, ActionValue>>();
  const advanceTo = async (ms: number) => {
    while (now < ms - 1e-7) {
      const boundary = (Math.floor(now / stepMs + 1e-7) + 1) * stepMs;
      const target = Math.min(ms, boundary);
      if (target >= boundary - 1e-7) {
        for (const [playerIndex, actions] of held) {
          if (Object.keys(actions).length === 0) continue;
          await hooks.inject({
            playerIndex,
            tick: Math.round(boundary / stepMs),
            source: 'keyboard',
            actions: { ...actions },
          });
          for (const [name, value] of Object.entries(actions)) if (value === false) delete actions[name];
        }
      }
      await hooks.advanceTime(target - now);
      now = target;
    }
  };
  const processUntil = async (frameMs: number) => {
    while (next < actions.length && actions[next]!.t * 1000 <= frameMs + 1e-7) {
      const action = actions[next++]!;
      await advanceTo(action.t * 1000);
      if ('click' in action) {
        if (!hooks.click) throw new Error('scripted clicks are unavailable');
        await hooks.click(action.click);
      } else {
        const state = held.get(action.playerIndex) ?? {};
        state[action.action] = action.value ?? action.phase === 'down';
        held.set(action.playerIndex, state);
      }
    }
    await advanceTo(frameMs);
  };
  for (let index = 0; index < Math.round(seconds * fps); index += 1) {
    await processUntil((index * 1000) / fps);
    await capture(index);
  }
  await processUntil(seconds * 1000);
}

async function timedFrames(
  hooks: HookDriver,
  script: TrailerInput[],
  seconds: number,
  fps: number,
  capture: (index: number) => Promise<void>,
): Promise<void> {
  let clockMs = 0;
  let timerMs = 0;
  let queued: Parameters<HookDriver['inject']>[0][] = [];
  const timedHooks = {
    advanceTime: async (ms: number) => {
      clockMs += ms;
      const frames = queued;
      queued = [];
      await hooks.game.evaluate(
        ({ timeMs, delta, input }) => {
          const state = window as unknown as {
            __gmTrailerAudio?: { timeMs: number };
            __gm?: { inject: (frame: (typeof input)[number]) => void; advanceForTrailer?: (ms: number) => void };
          };
          if (state.__gmTrailerAudio) state.__gmTrailerAudio.timeMs = timeMs;
          if (!state.__gm?.advanceForTrailer) throw new Error('game SDK does not support trailer stepping');
          for (const frame of input) state.__gm.inject(frame);
          state.__gm.advanceForTrailer(delta);
        },
        { timeMs: clockMs, delta: ms, input: frames },
      );
      const nextTimerMs = Math.round(clockMs);
      if (nextTimerMs > timerMs) await hooks.page.clock.runFor(nextTimerMs - timerMs);
      timerMs = nextTimerMs;
    },
    inject: async (frame: Parameters<HookDriver['inject']>[0]) => {
      queued.push(frame);
    },
    click: async (selector: string) => {
      await hooks.game.locator(selector).click({ timeout: 10_000 });
    },
  };
  await scriptedFrames(timedHooks, script, seconds, fps, capture);
}

/** Read the canvas directly, avoiding page screenshots and their GPU compositor dependency. */
export async function scriptedCanvasFrames(
  hooks: HookDriver,
  script: TrailerInput[],
  seconds: number,
  fps: number,
  dir: string,
): Promise<void> {
  const canvas = hooks.game.locator('canvas').first();
  await timedFrames(hooks, script, seconds, fps, async (index) => {
    const data = await canvas.evaluate((element) => {
      const gm = (window as unknown as { __gm?: { renderTrailer?: () => void } }).__gm;
      if (!gm?.renderTrailer) throw new Error('game SDK does not support trailer rendering');
      gm.renderTrailer();
      return (element as HTMLCanvasElement).toDataURL('image/png');
    });
    const match = /^data:image\/png;base64,(.+)$/.exec(data);
    if (!match) throw new Error('game canvas did not produce a PNG frame');
    writeFileSync(join(dir, `f${String(index).padStart(5, '0')}.png`), Buffer.from(match[1]!, 'base64'));
  });
}

/** Capture the page for games whose visible HUD or menus are HTML overlays. */
export async function scriptedPageFrames(
  hooks: HookDriver,
  script: TrailerInput[],
  seconds: number,
  fps: number,
  dir: string,
): Promise<void> {
  await timedFrames(hooks, script, seconds, fps, async (index) => {
    await hooks.game.evaluate(() => {
      const gm = (window as unknown as { __gm?: { renderTrailer?: () => void } }).__gm;
      if (!gm?.renderTrailer) throw new Error('game SDK does not support trailer rendering');
      gm.renderTrailer();
    });
    await hooks.page.screenshot({ path: join(dir, `f${String(index).padStart(5, '0')}.png`), type: 'png' });
  });
}
