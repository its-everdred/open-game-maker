import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import type { HookDriver } from '../src/hooks.js';
import { recordTrailerVideo } from '../src/trailer-video.js';

const ffmpegAvailable = ['ffmpeg', 'ffprobe'].every(
  (binary) => spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0,
);

it.skipIf(!ffmpegAvailable)(
  'encodes a 1280×720 phone-safe trailer at the requested frame rate (requires ffmpeg)',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trailer-video-'));
    const image = join(dir, 'frame.png');
    const output = join(dir, 'trailer.mp4');
    try {
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=red:size=32x32',
        '-frames:v',
        '1',
        image,
      ]);
      const data = `data:image/png;base64,${readFileSync(image).toString('base64')}`;
      const hooks = {
        advanceTime: async () => {},
        inject: async () => {},
        page: { clock: { runFor: async () => {} } },
        game: { evaluate: async () => {}, locator: () => ({ first: () => ({ evaluate: async () => data }) }) },
      } as unknown as HookDriver;
      await recordTrailerVideo(hooks, { script: [], seconds: 1, fps: 10 }, output);
      const probe = JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=width,height,codec_name,profile,level,pix_fmt,r_frame_rate',
            '-of',
            'json',
            output,
          ],
          { encoding: 'utf8' },
        ),
      );
      expect(probe.streams[0]).toMatchObject({
        width: 1280,
        height: 720,
        codec_name: 'h264',
        profile: 'Main',
        level: 41,
        pix_fmt: 'yuv420p',
        r_frame_rate: '10/1',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
