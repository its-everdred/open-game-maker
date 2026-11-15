import { expect, it } from 'vitest';

import { createAudio } from './index.js';
import { FakeAudioContext, FakeWindow, asWindow, contextConstructor } from './test/fake-audio.js';
import type { TrailerAudioCapture } from './trailer.js';

it('records requested sample and music assets at the capture clock without depending on audio unlock', () => {
  const capture: TrailerAudioCapture = { timeMs: 0, events: [], unsupported: [] };
  const win = Object.assign(new FakeWindow(), { __gmTrailerAudio: capture });
  const context = new FakeAudioContext();
  const audio = createAudio({
    rng: () => 0.5,
    win: asWindow(win),
    AudioContextCtor: contextConstructor(context),
    loader: {
      audio: async () => {
        throw new Error('must not decode');
      },
      resolve: (id) => ({ url: `/assets/${id}.ogg` }),
    },
  });
  audio.music('theme', { vol: 0.5 });
  capture.timeMs = 1200;
  audio.play('clear', { vol: 0.75, pitch: 0 });
  capture.timeMs = 2000;
  audio.music(null);
  expect(capture.events).toEqual([
    { type: 'music', timeMs: 0, id: 'theme', url: '/assets/theme.ogg', gain: 0.225, fade: 1.2 },
    { type: 'sample', timeMs: 1200, id: 'clear', url: '/assets/clear.ogg', gain: expect.closeTo(0.6), rate: 1 },
    { type: 'music-stop', timeMs: 2000, fade: 1.2 },
  ]);
  expect(context.sources).toHaveLength(0);
});

it('records synthesized effects using the same cached samples as live playback', () => {
  const capture: TrailerAudioCapture = { timeMs: 200, events: [], unsupported: [] };
  const win = Object.assign(new FakeWindow(), { __gmTrailerAudio: capture });
  const context = new FakeAudioContext();
  const audio = createAudio({ rng: () => 0.5, win: asWindow(win), AudioContextCtor: contextConstructor(context) });
  audio.zzfx([0.5, 0, 440, 0.01, 0.05, 0.01]);
  audio.zzfx([0.5, 0, 440, 0.01, 0.05, 0.01]);
  expect(capture.events).toHaveLength(2);
  const [first, second] = capture.events;
  expect(first?.type).toBe('synth');
  if (first?.type !== 'synth' || second?.type !== 'synth') throw new Error('missing synthesized audio');
  expect(first.samples.length).toBeGreaterThan(100);
  expect(first.samples.some((sample) => sample !== 0)).toBe(true);
  expect(second.samples).toEqual(first.samples);
  expect(capture.unsupported).toEqual([]);
});

it('uses the actual simulation tick when a cue occurs during a multi-step advance', () => {
  const capture: TrailerAudioCapture = { timeMs: 1000, events: [], unsupported: [] };
  const win = Object.assign(new FakeWindow(), { __gmTrailerAudio: capture, __gm: { probes: () => ({ tick: 30 }) } });
  const context = new FakeAudioContext();
  const audio = createAudio({ rng: () => 0.5, win: asWindow(win), AudioContextCtor: contextConstructor(context) });
  audio.play('clear', { pitch: 0 });
  expect(capture.events[0]?.timeMs).toBe(500);
});
