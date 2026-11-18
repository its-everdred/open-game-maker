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
  'encodes the scripted canvas as a 1920×1080 trailer a phone can play: Main profile, level 4.1 or lower (requires ffmpeg)',
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
      const stream = execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=width,height,profile,level,r_frame_rate',
          '-of',
          'default=nw=1',
          output,
        ],
        { encoding: 'utf8' },
      );
      const {
        width,
        height,
        profile,
        level,
        r_frame_rate: rate,
      } = Object.fromEntries(
        stream
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      );
      expect(`${width}x${height}`).toBe('1920x1080');
      /* x264's own pick (High, level 6.2) never played on the creator's phone. */
      expect(profile).toBe('Main');
      expect(Number(level)).toBeLessThanOrEqual(41);
      expect(rate).toBe('10/1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
