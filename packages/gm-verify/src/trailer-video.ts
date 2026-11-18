import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ffmpeg, FfmpegMissingError, hasFfmpeg } from './capture.js';
import type { HookDriver } from './hooks.js';
import type { TrailerInput } from './trailer-script.js';
import { scriptedCanvasFrames, scriptedPageFrames } from './trailer-frames.js';
import { TRAILER_SIZE } from './trailer-check.js';
import type { TrailerMenus } from './trailer-menus.js';

/** Encode canvas frames at delivery dimensions without distorting gameplay. */
export function trailerVideoArgs(dir: string, fps: number, output: string): string[] {
  const { width, height } = TRAILER_SIZE;
  return [
    '-framerate',
    String(fps),
    '-i',
    join(dir, 'f%05d.png'),
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-threads',
    '2',
    '-crf',
    '20',
    '-movflags',
    '+faststart',
    output,
  ];
}

export async function recordTrailerVideo(
  hooks: HookDriver,
  options: {
    script: TrailerInput[];
    seconds: number;
    fps: number;
    surface?: 'canvas' | 'page';
    menus?: TrailerMenus;
  },
  output: string,
  binary = 'ffmpeg',
): Promise<void> {
  if (!hasFfmpeg(binary)) throw new FfmpegMissingError(binary);
  mkdirSync(dirname(output), { recursive: true });
  const frames = mkdtempSync(`${output}.frames-`);
  try {
    const capture = options.surface === 'page' ? scriptedPageFrames : scriptedCanvasFrames;
    await capture(hooks, options.script, options.seconds, options.fps, frames, options.menus);
    ffmpeg(binary, trailerVideoArgs(frames, options.fps, output));
  } finally {
    rmSync(frames, { recursive: true, force: true });
  }
}
