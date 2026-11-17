import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { FfmpegMissingError, hasFfmpeg } from './capture.js';
import type { TrailerMenus } from './trailer-menus.js';

/** A game ships exactly one trailer, 16:9 landscape; the record beside it says which frames the capture saw in play. */
export const TRAILER_FILE = 'trailer-landscape.mp4';
export const TRAILER_SIZE = { width: 1920, height: 1080 } as const;
export const TRAILER_RECORD = 'trailer-landscape.frames.json';
const SECONDS = { min: 15, max: 30 };
// Concatenated clips can differ from the script's length by a few frames of audio.
const SECONDS_SLACK = 0.1;

const trailerRecordSchema = z.object({
  video: z.literal(TRAILER_FILE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  fps: z.number().int().positive(),
  menus: z.object({ selectors: z.array(z.string()), routes: z.array(z.string()) }),
  scenes: z
    .array(
      z.object({
        scenario: z.string().nullable(),
        seconds: z.number().positive(),
        frames: z.number().int().positive(),
        inPlay: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type TrailerRecord = z.infer<typeof trailerRecordSchema>;

/** Capture aborts on a menu frame, so every recorded frame was in play. */
export function trailerRecord(
  video: Buffer,
  fps: number,
  menus: TrailerMenus,
  script: { scenario?: string; seconds: number }[],
): TrailerRecord {
  return {
    video: TRAILER_FILE,
    sha256: createHash('sha256').update(video).digest('hex'),
    fps,
    menus,
    scenes: script.map((scene) => {
      const frames = Math.round(scene.seconds * fps);
      return { scenario: scene.scenario ?? null, seconds: scene.seconds, frames, inPlay: frames };
    }),
  };
}

type Probe = {
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
  format?: { duration?: string };
};

/** Every reason the media directory breaks the trailer standard; empty when it passes. */
export function checkTrailer(dir: string, menus: TrailerMenus, ffprobe = 'ffprobe'): string[] {
  const failures: string[] = [];
  const files = existsSync(dir) ? readdirSync(dir) : [];
  for (const file of files)
    if (/^trailer.*\.(mp4|m4v|mov|webm|mkv)$/iu.test(file) && file !== TRAILER_FILE)
      failures.push(`${file} is a second trailer; a game ships only ${TRAILER_FILE}`);
  const video = join(dir, TRAILER_FILE);
  if (!files.includes(TRAILER_FILE)) return [...failures, `${TRAILER_FILE} is missing from ${dir}`];

  if (!hasFfmpeg(ffprobe)) throw new FfmpegMissingError(ffprobe);
  let probe: Probe;
  try {
    probe = JSON.parse(
      execFileSync(
        ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name,width,height:format=duration',
          '-of',
          'json',
          video,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    ) as Probe;
  } catch {
    return [...failures, `${TRAILER_FILE} is not a readable video; capture the trailer again with gm trailer`];
  }
  const streams = probe.streams ?? [];
  const picture = streams.find((stream) => stream.codec_type === 'video');
  const sound = streams.find((stream) => stream.codec_type === 'audio');
  if (!picture) failures.push(`${TRAILER_FILE} has no video stream`);
  else {
    const { width = 0, height = 0 } = picture;
    if (width * 9 !== height * 16) failures.push(`${TRAILER_FILE} is ${width}×${height}, not 16:9 landscape`);
    else if (width !== TRAILER_SIZE.width || height !== TRAILER_SIZE.height)
      failures.push(`${TRAILER_FILE} is ${width}×${height}, not ${TRAILER_SIZE.width}×${TRAILER_SIZE.height}`);
    if (picture.codec_name !== 'h264') failures.push(`${TRAILER_FILE} video is ${picture.codec_name}, not H.264`);
  }
  if (sound?.codec_name !== 'aac')
    failures.push(`${TRAILER_FILE} ${sound ? `audio is ${sound.codec_name}, not AAC` : 'has no AAC audio'}`);
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration < SECONDS.min - SECONDS_SLACK || duration > SECONDS.max + SECONDS_SLACK)
    failures.push(
      `${TRAILER_FILE} runs ${probe.format?.duration ?? 'an unknown length'} s; a trailer runs ${SECONDS.min}–${SECONDS.max} s`,
    );

  const recordPath = join(dir, TRAILER_RECORD);
  if (!existsSync(recordPath))
    return [...failures, `${TRAILER_RECORD} is missing; capture the trailer with gm trailer`];
  let record: TrailerRecord;
  try {
    record = trailerRecordSchema.parse(JSON.parse(readFileSync(recordPath, 'utf8')));
  } catch {
    return [...failures, `${TRAILER_RECORD} is unreadable; capture the trailer again with gm trailer`];
  }
  if (record.sha256 !== createHash('sha256').update(readFileSync(video)).digest('hex'))
    failures.push(`${TRAILER_RECORD} records a different video; capture the trailer again with gm trailer`);
  for (const [index, scene] of record.scenes.entries())
    if (scene.inPlay !== scene.frames)
      failures.push(
        `scene ${index + 1}${scene.scenario ? ` (${scene.scenario})` : ''} shows a menu in ${scene.frames - scene.inPlay} of ${scene.frames} frames; trailers are gameplay only`,
      );
  const unseen = [
    ...menus.selectors.filter((selector) => !record.menus.selectors.includes(selector)),
    ...menus.routes.filter((route) => !record.menus.routes.includes(route)),
  ];
  if (unseen.length)
    failures.push(`the capture predates the manifest's menu markers (${unseen.join(', ')}); capture the trailer again`);
  return failures;
}
