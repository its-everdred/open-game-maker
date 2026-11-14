import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';
import { isCaptureWithAudio } from '../../src/review-rounds/audio.js';
import { makeDeps } from '../helpers.js';

const ffmpegAvailable =
  spawnSync('/usr/bin/ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('/usr/bin/ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const fixture = fileURLToPath(new URL('../build-chat/fixtures/tiny.mp4', import.meta.url));

it.skipIf(!ffmpegAvailable)('checks video and audio streams in the stored capture (requires ffmpeg)', async () => {
  const deps = makeDeps();
  const silent = await deps.blobStore.put(readFileSync(fixture), 'video/mp4');
  expect(await isCaptureWithAudio(deps.blobStore, silent.hash)).toBe(false);
  const directory = mkdtempSync(join(tmpdir(), 'ogm-review-audio-test-'));
  const output = join(directory, 'with-audio.mp4');
  try {
    execFileSync('/usr/bin/ffmpeg', [
      '-v',
      'error',
      '-i',
      fixture,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      output,
    ]);
    const audible = await deps.blobStore.put(readFileSync(output), 'video/mp4');
    expect(await isCaptureWithAudio(deps.blobStore, audible.hash)).toBe(true);
    expect(await isCaptureWithAudio(deps.blobStore, 'sound.wav')).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
