import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { HookDriver } from './hooks.js';
import { toFrame, type InputScript } from './inputs.js';

/** Advance in chronological order: input at a frame boundary is applied before that frame is drawn. */
export async function scriptedFrames(
  hooks: Pick<HookDriver, 'advanceTime' | 'inject'>,
  script: InputScript,
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
  const advanceTo = async (ms: number) => {
    if (ms > now) await hooks.advanceTime(ms - now);
    now = ms;
  };
  for (let index = 0; index < Math.round(seconds * fps); index += 1) {
    const frameMs = (index * 1000) / fps;
    while (next < actions.length && actions[next]!.t * 1000 <= frameMs + 1e-7) {
      const action = actions[next++]!;
      await advanceTo(action.t * 1000);
      await hooks.inject(toFrame(action));
    }
    await advanceTo(frameMs);
    await capture(index);
  }
}

/** Read the canvas directly, avoiding page screenshots and their GPU compositor dependency. */
export async function scriptedCanvasFrames(
  hooks: HookDriver,
  script: InputScript,
  seconds: number,
  fps: number,
  dir: string,
): Promise<void> {
  const canvas = hooks.game.locator('canvas').first();
  await scriptedFrames(hooks, script, seconds, fps, async (index) => {
    const data = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));
    const match = /^data:image\/png;base64,(.+)$/.exec(data);
    if (!match) throw new Error('game canvas did not produce a PNG frame');
    writeFileSync(join(dir, `f${String(index).padStart(5, '0')}.png`), Buffer.from(match[1]!, 'base64'));
  });
}
