import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { soundLogCues } from '../src/trailer-log.js';

it('matches recorded sounds to local build files and stops music on a change', () => {
  const root = mkdtempSync(join(tmpdir(), 'trailer-log-'));
  try {
    writeFileSync(join(root, 'music.ogg'), 'music');
    writeFileSync(join(root, 'clear.wav'), 'clear');
    const cues = soundLogCues(
      {
        unsupported: [],
        events: [
          { type: 'music', timeMs: 0, id: 'theme', url: '/music.ogg', gain: 0.3, fade: 1 },
          { type: 'sample', timeMs: 1200, id: 'clear', url: '/clear.wav', gain: 0.6, rate: 0.9 },
          { type: 'music-stop', timeMs: 2000, fade: 0.5 },
        ],
      },
      root,
      'http://127.0.0.1:1234/',
      5,
    );
    expect(cues).toEqual([
      { file: join(root, 'music.ogg'), time: 0, gain: 0.3, loop: true, length: 3, fadeIn: 1, fadeOut: 1 },
      { file: join(root, 'clear.wav'), time: 1.2, gain: 0.6, rate: 0.9 },
    ]);
    expect(() => soundLogCues({ unsupported: ['zzfx'], events: [] }, root, 'http://127.0.0.1:1234/', 5)).toThrow(
      'zzfx',
    );
    expect(() =>
      soundLogCues(
        {
          unsupported: [],
          events: [{ type: 'sample', timeMs: 0, id: 'x', url: 'https://other.test/x', gain: 1, rate: 1 }],
        },
        root,
        'http://127.0.0.1:1234/',
        5,
      ),
    ).toThrow('not on the game origin');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('writes captured synthesized samples as a playable WAV cue', () => {
  const root = mkdtempSync(join(tmpdir(), 'trailer-synth-'));
  try {
    const cues = soundLogCues(
      { unsupported: [], events: [{ type: 'synth', timeMs: 500, samples: [0, 0.5, -0.5], gain: 0.8 }] },
      root,
      'http://127.0.0.1:1234/',
      1,
      root,
    );
    expect(cues).toEqual([{ file: join(root, 'synth-0.wav'), time: 0.5, gain: 0.8 }]);
    expect(readFileSync(cues[0]!.file).subarray(0, 4).toString()).toBe('RIFF');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
