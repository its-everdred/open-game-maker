import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeAudioContext } from '../../test/audio-mock';

type Sound = typeof import('./index');

// lib/sound keeps one context per module instance: load a fresh copy for each test.
async function loadSound(): Promise<{ sound: Sound; ctx: FakeAudioContext }> {
  vi.resetModules();
  const sound = await import('./index');
  return { sound, ctx: FakeAudioContext.last! };
}

const audioResponse = () => new Response(new ArrayBuffer(8), { headers: { 'content-type': 'audio/mpeg' } });
const fetchMock = vi.fn(async (input: string) => {
  void input;
  return audioResponse();
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  (navigator as unknown as { audioSession: { type: string } }).audioSession = { type: 'auto' };
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockClear();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('unlock', () => {
  it('keeps playing on the iPhone silent switch and resumes the suspended context', async () => {
    const { sound, ctx } = await loadSound();

    sound.unlock();

    expect((navigator as unknown as { audioSession: { type: string } }).audioSession.type).toBe('playback');
    expect(ctx.resume).toHaveBeenCalledOnce();
  });

  it('runs on the first tap release, the event iOS accepts', async () => {
    const { ctx } = await loadSound();

    window.dispatchEvent(new Event('pointerup'));

    expect(ctx.resume).toHaveBeenCalledOnce();
  });

  it('does not resume a hidden tab', async () => {
    const { sound, ctx } = await loadSound();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    sound.unlock();

    expect(ctx.resume).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('ext', () => {
  it('plays nothing before the context is unlocked', async () => {
    const { sound, ctx } = await loadSound();
    fetchMock.mockClear();

    sound.ext('/town/models/sounds/tick.mp3', 0.5, 1);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.sources.filter((s) => s.start.mock.calls.length > 0)).toHaveLength(0);
  });

  it('plays the effect on the host context at the posted rate once unlocked', async () => {
    const { sound, ctx } = await loadSound();
    sound.unlock();
    await flush();
    const before = ctx.sources.length;

    sound.ext('/town/models/sounds/tick.mp3', 0.5, 1.25);
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/town/models/sounds/tick.mp3');
    const played = ctx.sources.slice(before);
    expect(played).toHaveLength(1);
    expect(played[0]!.playbackRate.value).toBe(1.25);
    expect(played[0]!.start).toHaveBeenCalled();
  });

  it('stops town sources and ignores loads that finish after the town leaves', async () => {
    const { sound, ctx } = await loadSound();
    sound.unlock();
    await flush();
    const before = ctx.sources.length;
    sound.extLoop('/town/models/sounds/fire.mp3', 0.4);
    sound.ext('/town/models/sounds/tick.mp3', 0.5, 1);
    await flush();
    await flush();
    const playing = ctx.sources.slice(before).filter((source) => source.start.mock.calls.length > 0);
    sound.extLoop('/town/models/sounds/late.mp3', 0.4);
    sound.extSilence();
    await flush();
    await flush();
    expect(playing.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(ctx.sources.slice(before).filter((source) => source.start.mock.calls.length > 0)).toHaveLength(2);
  });

  it('silences every town loop when the town goes away', async () => {
    const { sound, ctx } = await loadSound();
    sound.unlock();
    await flush();
    const before = ctx.gains.length;

    sound.extLoop('/town/models/sounds/fire.mp3', 0.4);
    sound.extLoop('/town/models/sounds/wind.mp3', 0.7);
    const loops = ctx.gains.slice(before);
    expect(loops.map((g) => g.gain.value)).toEqual([0.4, 0.7]);

    sound.extSilence();

    expect(loops.map((g) => g.gain.value)).toEqual([0, 0]);
  });
});

describe('music fallback', () => {
  it('stops the title track when leaving while audio is suspended', async () => {
    const { sound, ctx } = await loadSound();
    sound.unlock();
    sound.set('title', 0);
    await flush();
    await flush();
    const title = ctx.sources.at(-1)!;
    await ctx.suspend();
    sound.set('off', 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(title.stop).toHaveBeenCalledOnce();
  });

  it('treats the SPA HTML fallback as a missing track without trying to decode it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock
      .mockResolvedValueOnce(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(audioResponse());
    const { sound, ctx } = await loadSound();
    await sound.titleReady;

    sound.unlock();
    sound.set('title', 0);
    await flush();
    await flush();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/art/music/underground.mp3',
      '/art/music/space-cadet.mp3',
    ]);
    expect(ctx.decodeAudioData).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith('sound: licensed music unavailable; using built-in fallback');
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the normal warning when the built-in fallback is also unavailable', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
    const { sound, ctx } = await loadSound();
    await sound.titleReady;

    sound.unlock();
    sound.set('title', 0);
    await flush();
    await flush();

    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('sound', 'music/space-cadet', expect.any(Error));
  });
});

describe('mute and volume', () => {
  it('persists mute and unmutes when the volume is raised from silence', async () => {
    const { sound } = await loadSound();

    sound.setMuted(true);
    expect(sound.status()).toBe('off');
    expect(localStorage.getItem('ogm.sound')).toBe('off');

    sound.setVolume(0.4);

    expect(sound.status()).not.toBe('off');
    expect(localStorage.getItem('ogm.volume')).toBe('0.4');
  });

  it('starts muted after a reload when the player muted it', async () => {
    localStorage.setItem('ogm.sound', 'off');
    const { sound } = await loadSound();

    expect(sound.status()).toBe('off');
  });
});
