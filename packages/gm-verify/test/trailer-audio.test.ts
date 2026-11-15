import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { trailerAudioArgs } from '../src/trailer-audio.js';

describe('trailer audio mix', () => {
  it('places cues at their game times and limits the finished track', () => {
    const args = trailerAudioArgs('silent.mp4', 'trailer.mp4', 20, [
      { file: 'music.ogg', time: 0, gain: 0.5, loop: true },
      { file: 'clear.wav', time: 3.25, gain: 0.8 },
    ]);
    expect(args).toContain('music.ogg');
    expect(args).toContain('clear.wav');
    expect(args.join(' ')).toContain('adelay=3250:all=1');
    expect(args.join(' ')).toContain('volume=0.8');
    expect(args.join(' ')).toContain('alimiter=limit=0.891');
    expect(args).toEqual(expect.arrayContaining(['-t', '20', '-c:v', 'copy', '-c:a', 'aac']));
  });

  it('rejects invalid timing and gain before running ffmpeg', () => {
    expect(() => trailerAudioArgs('in', 'out', 1, [{ file: 'x', time: -1, gain: 1 }])).toThrow();
    expect(() => trailerAudioArgs('in', 'out', 1, [{ file: 'x', time: 0, gain: NaN }])).toThrow();
    expect(() => trailerAudioArgs('in', 'out', 0, [])).toThrow();
  });
});

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

it.skipIf(!ffmpegAvailable)(
  'mixes a real cue at its recorded time (requires ffmpeg)',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'trailer-mix-'));
    const video = join(dir, 'video.mp4');
    const cue = join(dir, 'cue.wav');
    const output = join(dir, 'output.mp4');
    const run = (args: string[]) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
    try {
      run(['-f', 'lavfi', '-i', 'color=size=16x16:rate=10:duration=1', '-c:v', 'libx264', video]);
      run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', cue]);
      run(trailerAudioArgs(video, output, 1, [{ file: cue, time: 0.4, gain: 1 }]));
      const pcm = run(['-i', output, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
      const peak = (start: number, end: number) => {
        let value = 0;
        for (let i = start * 48000; i < end * 48000; i++) value = Math.max(value, Math.abs(pcm.readFloatLE(i * 4)));
        return value;
      };
      expect(peak(0.1, 0.3)).toBeLessThan(0.001);
      expect(peak(0.42, 0.48)).toBeGreaterThan(0.03);
      expect(peak(0.7, 0.9)).toBeLessThan(0.001);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
