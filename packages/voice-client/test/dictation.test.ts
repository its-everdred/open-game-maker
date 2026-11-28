import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({
  startCapture: vi.fn(),
  stop: vi.fn(),
  setMuted: vi.fn(),
  onChunk: undefined as ((chunk: string) => void) | undefined,
  onLevel: undefined as ((level: number) => void) | undefined,
}));

vi.mock('../src/audio/capture.js', () => ({
  startCapture: audio.startCapture,
}));

import { Dictation } from '../src/dictation.js';

type Listener = (event: Record<string, unknown>) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(frame: string) {
    this.sent.push(frame);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  message(frame: object) {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  private emit(type: string, event: Record<string, unknown>) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Dictation', () => {
  let visibility: EventTarget & { visibilityState: string };

  beforeEach(() => {
    FakeWebSocket.instances = [];
    audio.stop.mockClear();
    audio.setMuted.mockClear();
    audio.startCapture.mockReset();
    audio.startCapture.mockImplementation(
      async (onChunk: (chunk: string) => void, onLevel?: (level: number) => void) => {
        audio.onChunk = onChunk;
        audio.onLevel = onLevel;
        return { stop: audio.stop, setMuted: audio.setMuted, context: {} };
      },
    );
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('AudioContext', class {});
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
    visibility = new EventTarget() as EventTarget & { visibilityState: string };
    visibility.visibilityState = 'visible';
    vi.stubGlobal('document', visibility);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is available through microphone capture without a browser speech-recognition API', () => {
    expect('SpeechRecognition' in globalThis).toBe(false);
    expect(Dictation.isSupported()).toBe(true);
  });

  it('forwards captured microphone levels to composer dictation callbacks', async () => {
    const dictation = new Dictation({
      connection: async () => ({ token: 'dictate-token', url: 'ws://127.0.0.1/ws/voice?mode=dictate' }),
    });
    const levels: number[] = [];
    dictation.on('level', (level) => levels.push(level));

    dictation.pressStart();
    await vi.waitFor(() => expect(audio.onLevel).toBeTypeOf('function'));
    audio.onLevel?.(0.7);

    expect(levels).toEqual([0.7]);
    dictation.cancel();
  });

  it('streams PCM to Scribe, publishes partial text, and commits exactly once on release', async () => {
    const dictation = new Dictation({
      connection: async () => ({ token: 'dictate-token', url: 'ws://127.0.0.1/ws/voice?mode=dictate' }),
    });
    const transcripts: Array<{ kind: string; text: string }> = [];
    dictation.on('transcript', (frame) => transcripts.push(frame));

    dictation.pressStart();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    audio.onChunk?.('AA==');
    socket.message({ v: 1, type: 'transcript', kind: 'partial', text: 'make the' });

    dictation.pressEnd();
    dictation.pressEnd();
    socket.message({ v: 1, type: 'transcript', kind: 'final', text: 'make the door red' });
    socket.message({ v: 1, type: 'ended' });

    expect(String(socket.url)).toContain('token=dictate-token');
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { v: 1, type: 'audio', data_b64: 'AA==' },
      { v: 1, type: 'commit' },
    ]);
    expect(transcripts).toEqual([
      { kind: 'partial', text: 'make the' },
      { kind: 'partial', text: 'make the door red' },
      { kind: 'final', text: 'make the door red' },
    ]);
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('keeps recording across provider phrase commits and returns the complete dictation', async () => {
    const dictation = new Dictation({ connection: async () => ({ token: 't', url: 'ws://127.0.0.1/ws' }) });
    const transcripts: Array<{ kind: string; text: string }> = [];
    dictation.on('transcript', (frame) => transcripts.push(frame));
    dictation.pressStart();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ v: 1, type: 'transcript', kind: 'final', text: 'Make the sky' });
    expect(socket.close).not.toHaveBeenCalled();
    audio.onChunk?.('AA==');
    socket.message({ v: 1, type: 'transcript', kind: 'partial', text: 'bright' });
    dictation.pressEnd();
    socket.message({ v: 1, type: 'transcript', kind: 'final', text: 'bright blue' });
    socket.message({ v: 1, type: 'ended' });
    expect(transcripts.at(-1)).toEqual({ kind: 'final', text: 'Make the sky bright blue' });
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { v: 1, type: 'audio', data_b64: 'AA==' },
      { v: 1, type: 'commit' },
    ]);
  });

  it('reports an unconfirmed partial when the provider closes without a final phrase', async () => {
    const dictation = new Dictation({ connection: async () => ({ token: 't', url: 'ws://127.0.0.1/ws' }) });
    const errors: string[] = [];
    const finals: string[] = [];
    dictation.on('error', (error) => errors.push(error.code));
    dictation.on('transcript', (frame) => {
      if (frame.kind === 'final') finals.push(frame.text);
    });
    dictation.pressStart();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message({ v: 1, type: 'transcript', kind: 'partial', text: 'make the sky' });
    dictation.pressEnd();
    socket.message({ v: 1, type: 'ended' });
    expect(errors).toEqual(['incomplete_transcript']);
    expect(finals).toEqual([]);
  });

  it('replays an early release after buffered audio reaches the socket', async () => {
    const connection = deferred<{ token: string; url: string }>();
    const dictation = new Dictation({ connection: () => connection.promise });

    dictation.pressStart();
    await vi.waitFor(() => expect(audio.startCapture).toHaveBeenCalledOnce());
    audio.onChunk?.('AQ==');
    dictation.pressEnd();
    connection.resolve({ token: 'token', url: 'ws://127.0.0.1/ws/voice?mode=dictate' });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { v: 1, type: 'audio', data_b64: 'AQ==' },
      { v: 1, type: 'commit' },
    ]);
    expect(audio.stop).toHaveBeenCalledOnce();
  });

  it('mutes and resumes audio without ending the dictation session', async () => {
    const dictation = new Dictation({
      connection: async () => ({ token: 'token', url: 'ws://127.0.0.1/ws/voice?mode=dictate' }),
    });
    dictation.pressStart();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    dictation.setMuted(true);
    audio.onChunk?.('muted');
    dictation.setMuted(false);
    audio.onChunk?.('heard');

    expect(audio.setMuted.mock.calls).toEqual([[true], [false]]);
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([{ v: 1, type: 'audio', data_b64: 'heard' }]);
    dictation.pressEnd();
    socket.message({ v: 1, type: 'transcript', kind: 'final', text: 'heard' });
  });

  it('mutes a capture that resolves after the user already muted', async () => {
    const capture = deferred<{ stop: typeof audio.stop; setMuted: typeof audio.setMuted; context: object }>();
    audio.startCapture.mockImplementationOnce(async (onChunk: (chunk: string) => void) => {
      audio.onChunk = onChunk;
      return capture.promise;
    });
    const dictation = new Dictation({
      connection: async () => ({ token: 'token', url: 'ws://127.0.0.1/ws/voice?mode=dictate' }),
    });

    dictation.pressStart();
    await vi.waitFor(() => expect(audio.startCapture).toHaveBeenCalledOnce());
    dictation.setMuted(true);
    capture.resolve({ stop: audio.stop, setMuted: audio.setMuted, context: {} });
    await vi.waitFor(() => expect(audio.setMuted).toHaveBeenCalledWith(true));

    audio.onChunk?.('muted');
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(socket.sent).toEqual([]);
    dictation.cancel();
  });

  it('discards audio buffered before the socket connects when muted', async () => {
    const connection = deferred<{ token: string; url: string }>();
    const dictation = new Dictation({ connection: () => connection.promise });

    dictation.pressStart();
    await vi.waitFor(() => expect(audio.startCapture).toHaveBeenCalledOnce());
    audio.onChunk?.('buffered');
    dictation.setMuted(true);
    connection.resolve({ token: 'token', url: 'ws://127.0.0.1/ws/voice?mode=dictate' });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    expect(socket.sent).toEqual([]);
    dictation.cancel();
  });

  it('maps microphone denial and releases resources on connection failure', async () => {
    audio.startCapture.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const dictation = new Dictation({
      connection: async () => ({ token: 'token', url: 'ws://127.0.0.1/ws/voice?mode=dictate' }),
    });
    const errors: Array<{ code: string; message: string }> = [];
    dictation.on('error', (error) => errors.push(error));

    dictation.pressStart();
    await vi.waitFor(() => expect(errors).toHaveLength(1));

    expect(errors).toEqual([{ code: 'mic_denied', message: 'Microphone permission denied.' }]);
    expect(FakeWebSocket.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it('names the token and capture causes without their messages', async () => {
    audio.startCapture.mockRejectedValueOnce(new DOMException('no device', 'NotFoundError'));
    const tokenError = Object.assign(new Error('wss://voice?token=secret'), { name: 'ApiError', status: 403 });
    const errors: Array<{ code: string; message: string }> = [];
    const capture = new Dictation({ connection: async () => ({ token: 't', url: 'ws://127.0.0.1/ws' }) });
    capture.on('error', (error) => errors.push(error));
    capture.pressStart();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    const token = new Dictation({ connection: () => Promise.reject(tokenError) });
    token.on('error', (error) => errors.push(error));
    token.pressStart();
    await vi.waitFor(() => expect(errors).toHaveLength(2));

    expect(errors).toEqual([
      { code: 'capture_error', message: 'Microphone capture failed (NotFoundError).' },
      { code: 'token_error', message: 'Dictation could not be authorized (ApiError 403).' },
    ]);
  });

  it('stops the provider and closes capture when the page is hidden', async () => {
    const dictation = new Dictation({
      connection: async () => ({ token: 'token', url: 'ws://127.0.0.1/ws/voice?mode=dictate' }),
    });

    dictation.pressStart();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    visibility.visibilityState = 'hidden';
    visibility.dispatchEvent(new Event('visibilitychange'));

    expect(socket.sent.map((frame) => JSON.parse(frame))).toContainEqual({ v: 1, type: 'stop' });
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
