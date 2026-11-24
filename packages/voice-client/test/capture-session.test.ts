import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCapture } from '../src/audio/capture.js';
import { PcmPlayer } from '../src/audio/playback.js';

// Safari's rule (WebCore MediaDevices::getUserMedia): an audio capture is refused while the page's audio session is
// anything but 'auto' or 'play-and-record'. The app sets 'playback' on every tap, which is why voice never started
// on Kevin's iPhone (#1325).
function safariNavigator(type: string) {
  const audioSession = { type };
  const tracks = [{ stop: vi.fn() }];
  const getUserMedia = vi.fn(async () => {
    if (audioSession.type !== 'auto' && audioSession.type !== 'play-and-record') {
      throw new DOMException('AudioSession category is not compatible with audio capture.', 'InvalidStateError');
    }
    return { getTracks: () => tracks };
  });
  return { audioSession, mediaDevices: { getUserMedia }, tracks };
}

class FakeContext {
  sampleRate = 48_000;
  state = 'running';
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  createScriptProcessor = () => ({ addEventListener: vi.fn(), connect: vi.fn(), disconnect: vi.fn() });
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
  createBufferSource = () => ({ buffer: null, connect: vi.fn(), start: vi.fn() });
  createBuffer = () => ({});
}

describe('capture audio session', () => {
  let nav: ReturnType<typeof safariNavigator>;

  beforeEach(() => {
    nav = safariNavigator('playback');
    vi.stubGlobal('navigator', nav);
    vi.stubGlobal('AudioContext', FakeContext);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the microphone after the app chose playback, and gives playback back when it closes', async () => {
    const capture = await startCapture(() => undefined);

    expect(nav.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(nav.audioSession.type).toBe('play-and-record');

    capture.stop();

    expect(nav.tracks[0]!.stop).toHaveBeenCalled();
    // The silent-switch fix still holds for game and menu sounds once the call is over.
    expect(nav.audioSession.type).toBe('playback');
  });

  it('keeps recording while the voice reply plays, so the conversation can go on', async () => {
    const capture = await startCapture(() => undefined);

    await new PcmPlayer(() => new FakeContext() as unknown as AudioContext).unlock();

    expect(nav.audioSession.type).toBe('play-and-record');
    capture.stop();
  });

  it('keeps the session for recording until the last of two captures closes', async () => {
    const first = await startCapture(() => undefined);
    const second = await startCapture(() => undefined);

    first.stop();
    expect(nav.audioSession.type).toBe('play-and-record');
    second.stop();
    expect(nav.audioSession.type).toBe('playback');
  });

  it('restores the session when the microphone is refused', async () => {
    nav.mediaDevices.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    await expect(startCapture(() => undefined)).rejects.toMatchObject({ name: 'NotAllowedError' });

    expect(nav.audioSession.type).toBe('playback');
  });

  it('still plays through the silent switch when no microphone is open', async () => {
    nav.audioSession.type = 'auto';

    await new PcmPlayer(() => new FakeContext() as unknown as AudioContext).unlock();

    expect(nav.audioSession.type).toBe('playback');
  });
});
