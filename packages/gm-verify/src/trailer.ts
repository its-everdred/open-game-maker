import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { launch, openGame } from './browser.js';
import { ffmpeg } from './capture.js';
import { trailerAudioArgs as trailerAudioArgsFor } from './trailer-audio.js';
import { trailerInputSchema } from './trailer-script.js';
import { soundLogCues, type SoundLog } from './trailer-log.js';
import { recordTrailerVideo, type TrailerSize } from './trailer-video.js';
import { acquireSlot, type SemaphoreOptions } from './semaphore.js';
import { serveStatic } from './server.js';

const scenarioSchema = z.strictObject({
  scenario: z.string().min(1).max(100).optional(),
  seconds: z.number().positive().max(30),
  inputs: z.array(trailerInputSchema).default([]),
  surface: z.enum(['canvas', 'page']).default('canvas'),
});
export const trailerScriptSchema = z
  .array(scenarioSchema)
  .min(1)
  .max(30)
  .superRefine((scenarios, ctx) => {
    const seconds = scenarios.reduce((sum, scene) => sum + scene.seconds, 0);
    if (seconds < 15 || seconds > 30)
      ctx.addIssue({ code: 'custom', message: 'trailer duration must be 15–30 seconds' });
    for (const scene of scenarios) {
      if (scene.inputs.some((step) => step.t >= scene.seconds))
        ctx.addIssue({ code: 'custom', message: 'input falls outside its scenario' });
    }
  });
export type TrailerScript = z.output<typeof trailerScriptSchema>;

/** Capture each named scenario in isolation, then assemble the two complete videos. */
export async function captureTrailer(options: {
  serveDir: string;
  outDir: string;
  script: TrailerScript;
  software: boolean;
  fps?: number;
  slots?: SemaphoreOptions;
}): Promise<string[]> {
  const script = trailerScriptSchema.parse(options.script);
  const fps = options.fps ?? 30;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('frame rate must be an integer from 1 to 60');
  if (script.some((scene) => Math.abs(scene.seconds * fps - Math.round(scene.seconds * fps)) > 1e-7))
    throw new Error('scenario durations must align to the frame rate');
  const duration = script.reduce((sum, scene) => sum + scene.seconds, 0);
  mkdirSync(options.outDir, { recursive: true });
  const tmp = mkdtempSync(join(options.outDir, '.trailer-'));
  let slot: Awaited<ReturnType<typeof acquireSlot>> | undefined;
  let server: Awaited<ReturnType<typeof serveStatic>> | undefined;
  let browser: Awaited<ReturnType<typeof launch>> | undefined;
  const timeoutMs = Math.max(10 * 60_000, duration * 120_000);
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    slot = await acquireSlot(options.slots);
    timer = setTimeout(() => {
      timedOut = true;
      void browser?.close().catch(() => {});
    }, timeoutMs);
    server = await serveStatic(options.serveDir);
    browser = await launch(options.software, options.software);
    if (timedOut) throw new Error(`trailer timed out after ${timeoutMs} ms`);
    const results: string[] = [];
    let audible = false;
    for (const orientation of ['portrait', 'landscape'] as const) {
      const clips: string[] = [];
      for (const [index, scene] of script.entries()) {
        const target = new URL(server.url);
        if (scene.scenario) target.searchParams.set('scenario', scene.scenario);
        const size = orientation === 'portrait' ? { width: 360, height: 640 } : { width: 640, height: 360 };
        const game = await openGame(browser, target.href, {
          viewport: 'phone',
          tier: 'mobile',
          trailerAudio: true,
          contextOptions: { viewport: size, deviceScaleFactor: 1 },
        });
        const silent = join(tmp, `${orientation}-${index}-silent.mp4`);
        const clip = join(tmp, `${orientation}-${index}.mp4`);
        try {
          await recordTrailerVideo(
            game.hooks,
            { script: scene.inputs, seconds: scene.seconds, fps, orientation, surface: scene.surface },
            silent,
          );
          const log = await game.game.evaluate(
            () => (window as unknown as { __gmTrailerAudio: SoundLog & { sdk?: boolean } }).__gmTrailerAudio,
          );
          if (!log?.sdk) throw new Error('game did not expose captured SDK audio events');
          const cues = soundLogCues(log, options.serveDir, server.url, scene.seconds, tmp);
          audible ||= cues.some((cue) => cue.gain > 0);
          ffmpeg('ffmpeg', trailerAudioArgsFor(silent, clip, scene.seconds, cues));
          clips.push(clip);
        } finally {
          await game.close();
        }
      }
      const list = join(tmp, `${orientation}.txt`);
      writeFileSync(list, clips.map((_, index) => `file '${orientation}-${index}.mp4'`).join('\n') + '\n');
      const assembled = join(tmp, `trailer-${orientation}.mp4`);
      ffmpeg('ffmpeg', ['-f', 'concat', '-safe', '1', '-i', list, '-c', 'copy', '-movflags', '+faststart', assembled]);
      results.push(assembled);
    }
    if (!audible) throw new Error('the game did not request audible SDK audio');
    return results.map((path, index) => {
      const destination = join(options.outDir, `trailer-${(['portrait', 'landscape'] as TrailerSize[])[index]}.mp4`);
      renameSync(path, destination);
      return destination;
    });
  } catch (error) {
    if (timedOut) throw new Error(`trailer timed out after ${timeoutMs} ms`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    slot?.release();
    rmSync(tmp, { recursive: true, force: true });
  }
}
