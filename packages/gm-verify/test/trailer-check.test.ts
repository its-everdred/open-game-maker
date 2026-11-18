import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { checkTrailer, TRAILER_FILE, TRAILER_RECORD, trailerRecord } from '../src/trailer-check.js';

const ffmpegAvailable = ['ffmpeg', 'ffprobe'].every(
  (binary) => spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0,
);
const none = { selectors: [], routes: [] };
let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailer-check-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A clip at the given size (15 s unless told) with optional AAC audio, plus a capture record when asked. */
function trailer(
  size: string,
  options: { audio?: boolean; record?: boolean; file?: string; seconds?: number; codec?: string } = {},
) {
  const seconds = options.seconds ?? 15;
  const file = join(dir, options.file ?? TRAILER_FILE);
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=green:size=${size}:duration=${seconds}:rate=2`,
    ...(options.audio === false ? [] : ['-f', 'lavfi', '-i', `sine=duration=${seconds}`, '-c:a', 'aac']),
    '-c:v',
    options.codec ?? 'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-shortest',
    file,
  ]);
  if (options.record !== false)
    writeFileSync(
      join(dir, TRAILER_RECORD),
      JSON.stringify(trailerRecord(readFileSync(file), 2, none, [{ scenario: 'combo', seconds }])),
    );
}

it('fails when the trailer is missing, before needing ffprobe', () => {
  expect(checkTrailer(dir, none)).toEqual([`${TRAILER_FILE} is missing from ${dir}`]);
});

it.skipIf(!ffmpegAvailable)(
  'passes the one 1920×1080 H.264 and AAC gameplay trailer (requires ffmpeg)',
  () => {
    trailer('1920x1080');
    expect(checkTrailer(dir, none)).toEqual([]);
  },
  60_000,
);

it.skipIf(!ffmpegAvailable)(
  'fails a portrait or non-16:9 cut and a second trailer file (requires ffmpeg)',
  () => {
    trailer('1080x1920');
    trailer('1080x1920', { file: 'trailer-portrait.mp4', record: false });
    const failures = checkTrailer(dir, none);
    expect(failures).toContain(`${TRAILER_FILE} is 1080×1920, not 16:9 landscape`);
    expect(failures).toContain(`trailer-portrait.mp4 is a second trailer; a game ships only ${TRAILER_FILE}`);
  },
  60_000,
);

it.skipIf(!ffmpegAvailable)(
  'fails a 16:9 cut below delivery size or without AAC audio (requires ffmpeg)',
  () => {
    trailer('640x360', { audio: false });
    expect(checkTrailer(dir, none)).toEqual([
      `${TRAILER_FILE} is 640×360, not 1920×1080`,
      `${TRAILER_FILE} has no AAC audio`,
    ]);
  },
  60_000,
);

it.skipIf(!ffmpegAvailable)(
  'fails without a capture record, or with one for another video (requires ffmpeg)',
  () => {
    trailer('1920x1080', { record: false });
    expect(checkTrailer(dir, none)).toEqual([`${TRAILER_RECORD} is missing; capture the trailer with gm trailer`]);
    writeFileSync(
      join(dir, TRAILER_RECORD),
      JSON.stringify(trailerRecord(Buffer.from('other'), 2, none, [{ seconds: 15 }])),
    );
    expect(checkTrailer(dir, none)).toEqual([
      `${TRAILER_RECORD} records a different video; capture the trailer again with gm trailer`,
    ]);
  },
  60_000,
);

it.skipIf(!ffmpegAvailable)(
  'fails menu frames and a capture made before the manifest named its menus (requires ffmpeg)',
  () => {
    trailer('1920x1080');
    const record = JSON.parse(readFileSync(join(dir, TRAILER_RECORD), 'utf8')) as ReturnType<typeof trailerRecord>;
    record.scenes[0]!.inPlay = 4;
    writeFileSync(join(dir, TRAILER_RECORD), JSON.stringify(record));
    expect(checkTrailer(dir, { selectors: ["[data-screen='title']"], routes: [] })).toEqual([
      'scene 1 (combo) shows a menu in 26 of 30 frames; trailers are gameplay only',
      "the capture predates the manifest's menu markers ([data-screen='title']); capture the trailer again",
    ]);
  },
  60_000,
);

it.skipIf(!ffmpegAvailable)(
  'fails a trailer shorter than 15 s or over 30 s (requires ffmpeg)',
  () => {
    trailer('1920x1080', { seconds: 1 });
    expect(checkTrailer(dir, none)).toEqual([`${TRAILER_FILE} runs 1.000000 s; a trailer runs 15–30 s`]);
    trailer('1920x1080', { seconds: 31 });
    expect(checkTrailer(dir, none)).toEqual([`${TRAILER_FILE} runs 31.000000 s; a trailer runs 15–30 s`]);
  },
  60_000,
);

it.skipIf(!ffmpegAvailable)(
  'fails a non-H.264 video and an unreadable file (requires ffmpeg)',
  () => {
    trailer('1920x1080', { codec: 'mpeg4' });
    expect(checkTrailer(dir, none)).toEqual([`${TRAILER_FILE} video is mpeg4, not H.264`]);
    writeFileSync(join(dir, TRAILER_FILE), 'not a video');
    expect(checkTrailer(dir, none)).toEqual([
      `${TRAILER_FILE} is not a readable video; capture the trailer again with gm trailer`,
    ]);
  },
  60_000,
);

it.skipIf(!ffmpegAvailable)(
  'fails a malformed record and one made before a manifest route (requires ffmpeg)',
  () => {
    trailer('1920x1080');
    const record = readFileSync(join(dir, TRAILER_RECORD), 'utf8');
    expect(checkTrailer(dir, { selectors: [], routes: ['#menu'] })).toEqual([
      "the capture predates the manifest's menu markers (#menu); capture the trailer again",
    ]);
    writeFileSync(join(dir, TRAILER_RECORD), JSON.stringify({ ...JSON.parse(record), scenes: [{ frames: 30 }] }));
    expect(checkTrailer(dir, none)).toEqual([
      `${TRAILER_RECORD} is unreadable; capture the trailer again with gm trailer`,
    ]);
  },
  60_000,
);
