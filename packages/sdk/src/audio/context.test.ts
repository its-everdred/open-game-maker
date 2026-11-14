import { describe, expect, it } from 'vitest';

import { createAudio } from './index.js';
import { FakeAudioContext, FakeWindow, asWindow, contextConstructor } from './test/fake-audio.js';

describe('createAudio context', () => {
  it('connects four buses through one master to the destination', () => {
    const context = new FakeAudioContext();
    const audio = createAudio({
      rng: () => 0.5,
      win: asWindow(new FakeWindow()),
      AudioContextCtor: contextConstructor(context),
    });

    expect(context.gains).toHaveLength(7);
    expect(Object.keys(audio.buses)).toEqual(['music', 'sfx', 'amb', 'voice']);
    expect(Object.values(audio.buses).map((bus) => bus.gain.value)).toEqual([0.45, 0.8, 0.6, 1]);
    expect((audio.buses.music as unknown as { connections: unknown[] }).connections[0]).toBe(context.gains[2]);
    expect((audio.buses.sfx as unknown as { connections: unknown[] }).connections[0]).toBe(context.gains[1]);
    expect(context.gains[1]!.connections).toEqual([context.gains[0]]);
    expect(context.gains[2]!.connections).toEqual([context.gains[0]]);
    expect(context.gains[0]!.connections).toEqual([context.destination]);
    expect(audio.context).toBe(context);
  });

  it('ramps mute and independent sound and music levels', () => {
    const context = new FakeAudioContext();
    const audio = createAudio({
      rng: () => 0.5,
      win: asWindow(new FakeWindow()),
      AudioContextCtor: contextConstructor(context),
    });
    const master = context.gains[0]!;

    const statuses: string[] = [];
    audio.onStatus((status) => statuses.push(status));
    audio.applySettings({ mute: true, volume: 0.5 });
    audio.applySettings({ mute: false, volume: 0.5, musicVolume: 0.25 });

    expect(master.gain.targets).toEqual([
      [0, 4, 0.05],
      [1, 4, 0.05],
    ]);
    expect(context.gains[2]!.gain.targets.at(-1)).toEqual([0.25, 4, 0.05]);
    expect(context.gains[1]!.gain.targets.at(-1)).toEqual([0.5, 4, 0.05]);
    expect(audio.status()).toBe('tap');
    expect(statuses).toEqual(['off', 'tap']);
  });

  it('keeps legacy volume controlling both buses when musicVolume is absent', () => {
    const context = new FakeAudioContext();
    const audio = createAudio({
      rng: () => 0.5,
      win: asWindow(new FakeWindow()),
      AudioContextCtor: contextConstructor(context),
    });
    audio.applySettings({ mute: false, volume: 0.3 });
    expect(context.gains[1]!.gain.targets.at(-1)).toEqual([0.3, 4, 0.05]);
    expect(context.gains[2]!.gain.targets.at(-1)).toEqual([0.3, 4, 0.05]);
  });
});
