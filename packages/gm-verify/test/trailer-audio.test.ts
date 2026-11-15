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
