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
  'encodes the scripted canvas at portrait dimensions (requires ffmpeg)',
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
      await recordTrailerVideo(hooks, { script: [], seconds: 1, fps: 1, orientation: 'portrait' }, output);
      const size = execFileSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', output],
        { encoding: 'utf8' },
      ).trim();
      expect(size).toBe('1080x1920');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
