import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FfmpegMissingError, hasFfmpeg } from './capture.js';
import type { TrailerMenus } from './trailer-menus.js';

/** A game ships exactly one trailer, 16:9 landscape; the record beside it says which frames the capture saw in play. */
export const TRAILER_FILE = 'trailer-landscape.mp4';
export const TRAILER_SIZE = { width: 1920, height: 1080 } as const;
export const TRAILER_RECORD = 'trailer-landscape.frames.json';
const MAX_SECONDS = 30;

export type TrailerRecord = {
  video: string;
  sha256: string;
  fps: number;
  menus: TrailerMenus;
  scenes: { scenario: string | null; seconds: number; frames: number; inPlay: number }[];
};

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
  const probe = JSON.parse(
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
      {
        encoding: 'utf8',
      },
    ),
  ) as Probe;
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
  // Concatenated AAC frames can overrun the video by a few milliseconds.
  if (!Number.isFinite(duration) || duration > MAX_SECONDS + 0.1)
    failures.push(
      `${TRAILER_FILE} runs ${probe.format?.duration ?? 'an unknown length'} s; the limit is ${MAX_SECONDS} s`,
    );

  const recordPath = join(dir, TRAILER_RECORD);
  if (!existsSync(recordPath))
    return [...failures, `${TRAILER_RECORD} is missing; capture the trailer with gm trailer`];
  let record: TrailerRecord;
  try {
    record = JSON.parse(readFileSync(recordPath, 'utf8')) as TrailerRecord;
    if (
      !Array.isArray(record.scenes) ||
      !Array.isArray(record.menus?.selectors) ||
      !Array.isArray(record.menus?.routes)
    )
      throw new Error('missing fields');
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
