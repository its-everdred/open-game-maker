import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({
  startCapture: vi.fn(),
  captureStop: vi.fn(),
  captureMute: vi.fn(),
  onChunk: undefined as ((chunk: string) => void) | undefined,
  players: [] as Array<{ enqueue: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
}));

vi.mock('../src/audio/capture.js', () => ({
  startCapture: audio.startCapture,
}));

vi.mock('../src/audio/playback.js', () => ({
  PcmPlayer: class {
    enqueue = vi.fn();
    stop = vi.fn();
    unlock = vi.fn(async () => undefined);
    close = vi.fn();

    constructor() {
      audio.players.push(this);
    }
  },
}));

import { VoiceClient } from '../src/client.js';

type Listener = (event: Record<string, unknown>) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  listeners = new Map<string, Set<Listener>>();
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit('close', { code: 1000 });
  });

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(value: string) {
    this.sent.push(value);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  message(frame: object) {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  closeWith(code: number) {
    this.readyState = 3;
    this.emit('close', { code });
  }

  error() {
    this.emit('error', {});
  }

  private emit(type: string, event: Record<string, unknown>) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

async function startedClient() {
  const client = new VoiceClient({
    url: 'ws://127.0.0.1:4567/voice?room=one',
    token: 'a token',
    target: { id: 'ticket-42' },
  });
  const started = client.startFromGesture();
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const socket = FakeWebSocket.instances[0]!;
  socket.open();
  await started;
  return { client, socket };
}

describe('VoiceClient', () => {
  let visibility: EventTarget & { visibilityState: string };

  beforeEach(() => {
    FakeWebSocket.instances = [];
    audio.players.length = 0;
    audio.onChunk = undefined;
    audio.captureStop.mockClear();
    audio.captureMute.mockClear();
    audio.startCapture.mockReset();
    audio.startCapture.mockImplementation(async (onChunk: (chunk: string) => void) => {
      audio.onChunk = onChunk;
      return { stop: audio.captureStop, setMuted: audio.captureMute, context: {} };
    });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    visibility = new EventTarget() as EventTarget & { visibilityState: string };
    visibility.visibilityState = 'visible';
    vi.stubGlobal('document', visibility);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('connects with the token, starts the target, and streams captured PCM', async () => {
    const { socket } = await startedClient();

    expect(String(socket.url)).toBe('ws://127.0.0.1:4567/voice?room=one&token=a+token');
    expect(JSON.parse(socket.sent[0]!)).toEqual({ v: 1, type: 'start', target: { id: 'ticket-42' } });

    audio.onChunk?.('AA==');
    expect(JSON.parse(socket.sent[1]!)).toEqual({ v: 1, type: 'audio', data_b64: 'AA==' });
  });

  it('mutes and resumes microphone audio during a live conversation', async () => {
    const { client, socket } = await startedClient();
    client.setMuted(true);
    audio.onChunk?.('muted');
    client.setMuted(false);
    audio.onChunk?.('heard');

    expect(audio.captureMute.mock.calls).toEqual([[true], [false]]);
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual(['start', 'audio']);
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({ data_b64: 'heard' });
    client.end();
  });

  it('shares one capture and socket across concurrent starts', async () => {
    const client = new VoiceClient({
      url: 'ws://127.0.0.1:4567/voice',
      token: 'token',
      target: { id: 'ticket-42' },
    });

    const first = client.startFromGesture();
    const second = client.startFromGesture();
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));

    expect(audio.startCapture).toHaveBeenCalledOnce();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]!.open();
    await Promise.all([first, second]);
  });

  it('cancels a pending start without reopening the session', async () => {
    const client = new VoiceClient({
      url: 'ws://127.0.0.1:4567/voice',
      token: 'token',
      target: { id: 'ticket-42' },
    });
    const ended: string[] = [];
    const errors: string[] = [];
    client.on('ended', (frame) => ended.push(frame.reason));
    client.on('error', (frame) => errors.push(frame.code));

    const started = client.startFromGesture();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;
    client.end();

    await expect(started).resolves.toBeUndefined();
    socket.open();

    expect(socket.sent).toEqual([]);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(audio.captureStop).toHaveBeenCalledOnce();
    expect(ended).toEqual(['user_end']);
    expect(errors).toEqual([]);
  });

  it('ignores a failed socket closing after a retry connects', async () => {
    const client = new VoiceClient({
      url: 'ws://127.0.0.1:4567/voice',
      token: 'token',
      target: { id: 'ticket-42' },
    });

    const firstStart = client.startFromGesture();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const failedSocket = FakeWebSocket.instances[0]!;
    failedSocket.error();
    await expect(firstStart).rejects.toMatchObject({ code: 'socket_error' });

    const retry = client.startFromGesture();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    const activeSocket = FakeWebSocket.instances[1]!;
    activeSocket.open();
    await retry;
    failedSocket.closeWith(1006);

    activeSocket.message({ v: 1, type: 'state', state: 'listening', capabilities: { text: true } });
    client.sendText('still connected');
    expect(JSON.parse(activeSocket.sent.at(-1)!)).toMatchObject({
      type: 'text',
      text: 'still connected',
    });
  });

  it('maps microphone permission denial to the public error code', async () => {
    audio.startCapture.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const client = new VoiceClient({
      url: 'ws://127.0.0.1:4567/voice',
      token: 'token',
      target: { id: 'ticket-42' },
    });
    const errors: string[] = [];
    client.on('error', (frame) => errors.push(frame.code));

    await expect(client.startFromGesture()).rejects.toMatchObject({ code: 'mic_denied' });
    expect(errors).toEqual(['mic_denied']);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('dispatches typed frames and controls playback', async () => {
    const { client, socket } = await startedClient();
    const texts: string[] = [];
    client.on('agent_text', (frame) => texts.push(frame.text));

    socket.message({ v: 1, type: 'agent_text', turn_id: 'one', text: 'Hello.', final: true });
    socket.message({ v: 1, type: 'agent_audio', turn_id: 'one', format: 'pcm_16000', data_b64: 'AA==' });
    socket.message({ v: 1, type: 'interrupted', turn_id: 'one' });

    expect(texts).toEqual(['Hello.']);
    expect(audio.players[0]?.enqueue).toHaveBeenCalledOnce();
    expect(audio.players[0]?.stop).toHaveBeenCalledOnce();
  });

  it('sends text only after the host advertises that capability', async () => {
    const { client, socket } = await startedClient();

    client.sendText('before');
    socket.message({ v: 1, type: 'state', state: 'listening', capabilities: { text: true } });
    client.sendText('after');

    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual(['start', 'text']);
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({ text: 'after' });
  });

  it('surfaces unauthorized close and records elapsed minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { client, socket } = await startedClient();
    const errors: string[] = [];
    client.on('error', (frame) => errors.push(frame.code));

    vi.setSystemTime(new Date('2026-01-01T00:01:30Z'));
    socket.closeWith(4401);

    expect(errors).toEqual(['unauthorized']);
    expect(client.minutes()).toBeCloseTo(1.5);
    expect(audio.captureStop).toHaveBeenCalledOnce();
  });

  it('ends the wire session and releases browser audio resources', async () => {
    const { client, socket } = await startedClient();
    const ended: string[] = [];
    client.on('ended', (frame) => ended.push(frame.reason));

    client.end();

    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: 'end' });
    expect(audio.captureStop).toHaveBeenCalledOnce();
    expect(audio.players[0]?.close).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(ended).toEqual(['user_end']);
  });

  it('ends and closes the session when the page is hidden', async () => {
    const { socket } = await startedClient();

    visibility.visibilityState = 'hidden';
    visibility.dispatchEvent(new Event('visibilitychange'));

    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: 'end' });
    expect(audio.captureStop).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
