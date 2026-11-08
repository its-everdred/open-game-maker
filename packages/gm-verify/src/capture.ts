import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import type { HookDriver } from './hooks.js';

/** SwiftShader is slow: at most this many stills and seconds of clip (D-VERIFY-GPU). */
export const SOFTWARE_MAX_FRAMES = 6;
export const SOFTWARE_MAX_RECORD_S = 5;
export const MAX_CAPTURE_FRAMES = 120;
export const FFMPEG_HINT = 'sudo apt install ffmpeg';
/** A synchronous encode blocks the run's timeout timer, so ffmpeg carries its own limit. */
export const FFMPEG_TIMEOUT_MS = 5 * 60_000;

/** ffmpeg is missing: the caller refuses (exit 2) with the install hint; stills are already written. */
export class FfmpegMissingError extends Error {
  constructor(readonly binary: string) {
    super(`${binary} not found on PATH`);
    this.name = 'FfmpegMissingError';
  }
}

export function hasFfmpeg(binary = 'ffmpeg'): boolean {
  const probe = spawnSync(binary, ['-version'], { stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
}

export function ffmpeg(binary: string, args: string[]): void {
  if (!hasFfmpeg(binary)) throw new FfmpegMissingError(binary);
  execFileSync(binary, ['-loglevel', 'error', '-y', ...args], { timeout: FFMPEG_TIMEOUT_MS, killSignal: 'SIGKILL' });
}

function h264Args(out: string, preset: 'fast' | 'slow' = 'fast'): string[] {
  return [
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-preset',
    preset,
    '-crf',
    '27',
    '-movflags',
    '+faststart',
    out,
  ];
}

async function shot(h: HookDriver, ms: number, path: string, type: 'png' | 'jpeg' = 'png'): Promise<void> {
  await h.renderAt(ms);
  await h.page.screenshot({ path, type, ...(type === 'jpeg' ? { quality: 92 } : {}) });
}

/** Frames read back per page round trip; bounds the data URLs held in memory at once. */
export const CANVAS_FRAME_CHUNK = 60;

/**
 * Renders each frame through the page's deterministic hook and reads the game canvas back as PNG, so a native clip
 * holds exactly one image per requested frame (a MediaRecorder stream drops frames under load).
 */
async function canvasFrames(
  h: HookDriver,
  options: { seconds: number; fps: number; start: number },
  dir: string,
): Promise<{ width: number; height: number }> {
  const total = Math.round(options.seconds * options.fps);
  let size = { width: 0, height: 0 };
  for (let first = 0; first < total; first += CANVAS_FRAME_CHUNK) {
    const count = Math.min(CANVAS_FRAME_CHUNK, total - first);
    const chunk = await h.page.locator('canvas').evaluate(
      (element, capture) => {
        const source = element as HTMLCanvasElement;
        type BrowserHooks = { renderAt?: (ms: number) => void; advanceTime?: (ms: number) => void };
        const browser = window as unknown as { __gm?: BrowserHooks; __frame?: (seconds: number) => void };
        const hooks = browser.__gm;
        let clockMs = capture.clockMs;
        const frames: string[] = [];
        for (let frame = capture.first; frame < capture.first + capture.count; frame += 1) {
          const ms = (capture.start + frame / capture.fps) * 1_000;
          for (let pass = 0; pass < capture.passes; pass += 1) {
            if (hooks?.renderAt) hooks.renderAt(ms);
            else if (hooks?.advanceTime) hooks.advanceTime(Math.max(0, ms - clockMs));
            else if (browser.__frame) browser.__frame(ms / 1_000);
            else throw new Error('page exposes no deterministic frame hook');
            clockMs = ms;
          }
          frames.push(source.toDataURL('image/png'));
        }
        return { frames, width: source.width, height: source.height };
      },
      {
        ...options,
        first,
        count,
        passes: h.passes,
        clockMs: (options.start + Math.max(0, first - 1) / options.fps) * 1_000,
      },
    );
    if (chunk.frames.length !== count) throw new Error(`canvas returned ${chunk.frames.length} of ${count} frames`);
    for (const [index, url] of chunk.frames.entries()) {
      writeFileSync(
        join(dir, `f${String(first + index).padStart(5, '0')}.png`),
        Buffer.from(url.split(',')[1] ?? '', 'base64'),
      );
    }
    size = { width: chunk.width, height: chunk.height };
  }
  return size;
}

/** One still per time (seconds) at `<dir>/t<t>.png`. */
export async function stills(h: HookDriver, times: number[], dir: string): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const t of times) {
    const path = join(dir, `t${t}.png`);
    await shot(h, t * 1000, path);
    paths.push(path);
  }
  return paths;
}

/** The capture.mjs `xstack` layout: 4 per row, last frame repeated to fill the grid, scaled to 1600 px wide. */
export function tileArgs(files: string[], out: string): string[] {
  const cols = Math.min(4, files.length);
  const rows = Math.ceil(files.length / cols);
  const cells = cols * rows;
  const inputs = Array.from({ length: cells }, (_, i) => `[${Math.min(i, files.length - 1)}]`).join('');
  const layout = Array.from({ length: cells }, (_, i) => {
    const x = i % cols === 0 ? '0' : Array.from({ length: i % cols }, () => 'w0').join('+');
    const row = Math.floor(i / cols);
    const y = row === 0 ? '0' : Array.from({ length: row }, () => 'h0').join('+');
    return `${x}_${y}`;
  }).join('|');
  const filter = cells === 1 ? '[0]scale=1600:-1' : `${inputs}xstack=inputs=${cells}:layout=${layout},scale=1600:-1`;
  return [...files.flatMap((file) => ['-i', file]), '-filter_complex', filter, '-frames:v', '1', out];
}

export function tile(files: string[], out: string, binary = 'ffmpeg'): void {
  if (files.length === 0) throw new Error('nothing to tile');
  mkdirSync(dirname(out), { recursive: true });
  ffmpeg(binary, tileArgs(files, out));
}

/** Frames at `times` (seconds) tiled in time order into one PNG. */
export async function timeline(h: HookDriver, times: number[], out: string, binary = 'ffmpeg'): Promise<void> {
  if (!hasFfmpeg(binary)) throw new FfmpegMissingError(binary);
  const tmp = mkdtempSync(`${out}.frames-`);
  try {
    const files: string[] = [];
    for (const [i, t] of times.entries()) {
      const file = join(tmp, `${String(i).padStart(3, '0')}.png`);
      await shot(h, t * 1000, file);
      files.push(file);
    }
    tile(files, out, binary);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The phone-verified encode (E10-2): H.264, yuv420p, 960 px wide, CRF 27, moov first. */
export function clipArgs(framesDir: string, fps: number, out: string): string[] {
  return [
    '-framerate',
    String(fps),
    '-i',
    join(framesDir, 'f%05d.jpg'),
    '-vf',
    'scale=960:-2:in_range=full:out_range=tv,format=yuv420p',
    ...h264Args(out, 'slow'),
  ];
}

/** Native encode of canvas frames: whole-number nearest-neighbour upscale, or the canvas size rounded to even. */
export function nativeClipArgs(
  framesDir: string,
  fps: number,
  out: string,
  nativeSize?: { width: number; height: number },
): string[] {
  const size = nativeSize ? `${nativeSize.width}:${nativeSize.height}` : 'trunc(iw/2)*2:trunc(ih/2)*2';
  return [
    '-framerate',
    String(fps),
    '-i',
    join(framesDir, 'f%05d.png'),
    '-vf',
    `scale=${size}:flags=neighbor:in_range=full:out_range=tv,format=yuv420p`,
    ...h264Args(out),
  ];
}

export type RecordOptions = { seconds: number; fps?: number; start?: number; native?: boolean };

/** Native output keeps the canvas backing size unless the viewport is an exact whole-number upscale of it. */
export function nativeUpscale(
  source: { width: number; height: number },
  viewport: { width: number; height: number } | null,
): { width: number; height: number } | undefined {
  if (!viewport || source.width <= 0 || source.height <= 0) return undefined;
  const factor = viewport.width / source.width;
  const even = viewport.width % 2 === 0 && viewport.height % 2 === 0;
  return Number.isInteger(factor) && factor >= 1 && source.height * factor === viewport.height && even
    ? viewport
    : undefined;
}

export async function record(h: HookDriver, options: RecordOptions, out: string, binary = 'ffmpeg'): Promise<void> {
  if (!hasFfmpeg(binary)) throw new FfmpegMissingError(binary);
  const fps = options.fps ?? 30;
  const start = options.start ?? 0;
  mkdirSync(dirname(out), { recursive: true });
  const tmp = mkdtempSync(`${out}.frames-`);
  try {
    if (!options.native) {
      for (let i = 0; i < Math.round(options.seconds * fps); i += 1) {
        await shot(h, (start + i / fps) * 1000, join(tmp, `f${String(i).padStart(5, '0')}.jpg`), 'jpeg');
      }
      ffmpeg(binary, clipArgs(tmp, fps, out));
      return;
    }

    const sourceSize = await canvasFrames(h, { seconds: options.seconds, fps, start }, tmp);
    ffmpeg(binary, nativeClipArgs(tmp, fps, out, nativeUpscale(sourceSize, h.page.viewportSize())));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** `0:10:0.5` → [0, 0.5, ..., 10]. */
export function timelineTimes(spec: { from: number; to: number; step: number }): number[] {
  const count = Math.floor((spec.to - spec.from) / spec.step) + 1;
  if (
    !Number.isFinite(spec.from) ||
    !Number.isFinite(spec.to) ||
    !Number.isFinite(spec.step) ||
    spec.from < 0 ||
    spec.to < spec.from ||
    spec.step <= 0 ||
    count < 1 ||
    count > MAX_CAPTURE_FRAMES
  )
    throw new Error(`timeline must contain 1-${MAX_CAPTURE_FRAMES} non-negative frames`);
  const times: number[] = [];
  for (let i = 0; ; i += 1) {
    const t = +(spec.from + i * spec.step).toFixed(6);
    if (t > spec.to + 1e-9) break;
    times.push(t);
  }
  return times;
}

export function relativeTo(outDir: string, path: string): string {
  return relative(outDir, path).split('\\').join('/');
}
