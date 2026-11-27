import { startCapture, type CaptureHandle } from './audio/capture.js';

export interface DictationTranscript {
  kind: 'partial' | 'final';
  text: string;
}

export interface DictationError {
  code: string;
  message: string;
}

export interface DictationConnection {
  token: string;
  url: string;
}

export interface DictationOptions {
  connection(): Promise<DictationConnection>;
}

type DictationEventMap = {
  transcript: DictationTranscript;
  error: DictationError;
  level: number;
};

const MAX_BUFFERED_BASE64_BYTES = 640_000;

export class Dictation {
  static readonly vendorNote = 'ElevenLabs Scribe transcription uses provider credits while the microphone is active.';

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof AudioContext !== 'undefined'
    );
  }

  private readonly listeners = new Map<keyof DictationEventMap, Set<(value: never) => void>>();
  private capture: CaptureHandle | undefined;
  private socket: WebSocket | undefined;
  private pendingChunks: string[] = [];
  private pendingBytes = 0;
  private generation = 0;
  private muted = false;
  private started = false;
  private released = false;
  private committed = false;
  private finished = false;

  constructor(private readonly options: DictationOptions) {}

  on<K extends keyof DictationEventMap>(event: K, listener: (value: DictationEventMap[K]) => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener as (value: never) => void);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener as (value: never) => void);
  }

  pressStart(): void {
    if (this.started) return;
    if (!Dictation.isSupported()) {
      this.emit('error', { code: 'unsupported', message: 'Microphone dictation is unavailable.' });
      return;
    }

    const generation = this.reset();
    this.watchVisibility();
    void this.beginCapture(generation);
    void this.beginSocket(generation);
  }

  pressEnd(): void {
    if (!this.started || this.released) return;
    this.released = true;
    this.stopCapture();
    this.commitIfReady();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.pendingChunks = [];
      this.pendingBytes = 0;
    }
    this.capture?.setMuted(muted);
  }

  cancel(): void {
    if (!this.started || this.finished) return;
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ v: 1, type: 'stop' });
    this.finish();
  }

  private reset(): number {
    this.generation += 1;
    this.pendingChunks = [];
    this.pendingBytes = 0;
    this.started = true;
    this.muted = false;
    this.released = false;
    this.committed = false;
    this.finished = false;
    return this.generation;
  }

  private async beginCapture(generation: number): Promise<void> {
    try {
      const capture = await startCapture(
        (chunk) => this.sendAudio(generation, chunk),
        (level) => this.emit('level', level),
      );
      if (generation !== this.generation || this.finished || this.released) {
        capture.stop();
      } else {
        this.capture = capture;
        if (this.muted) capture.setMuted(true);
      }
    } catch (error) {
      if (generation !== this.generation || this.finished) return;
      this.fail(this.captureError(error));
    }
  }

  private async beginSocket(generation: number): Promise<void> {
    try {
      const connection = await this.options.connection();
      if (generation !== this.generation) return;
      const url = new URL(connection.url);
      url.searchParams.set('token', connection.token);
      const socket = new WebSocket(url);
      this.socket = socket;

      if (this.finished) {
        socket.close();
        return;
      }

      socket.addEventListener('open', () => {
        if (socket !== this.socket || this.finished) return;
        for (const chunk of this.pendingChunks) this.send({ v: 1, type: 'audio', data_b64: chunk });
        this.pendingChunks = [];
        this.pendingBytes = 0;
        this.commitIfReady();
      });
      socket.addEventListener('message', (event) => this.receive(socket, event as MessageEvent));
      socket.addEventListener('error', () => {
        if (socket === this.socket && !this.finished) {
          this.fail({ code: 'socket_error', message: 'Dictation connection failed.' });
        }
      });
      socket.addEventListener('close', () => {
        if (socket === this.socket && !this.finished) {
          this.fail({ code: 'socket_error', message: 'Dictation connection closed before transcription finished.' });
        }
      });
    } catch (error) {
      if (generation === this.generation && !this.finished) {
        this.fail({ code: 'token_error', message: `Dictation could not be authorized (${causeName(error)}).` });
      }
    }
  }

  private sendAudio(generation: number, chunk: string): void {
    if (generation !== this.generation || this.finished || this.released || this.muted) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ v: 1, type: 'audio', data_b64: chunk });
      return;
    }

    this.pendingBytes += chunk.length;
    if (this.pendingBytes > MAX_BUFFERED_BASE64_BYTES) {
      this.fail({ code: 'audio_backlog', message: 'Dictation took too long to connect. Try again.' });
      return;
    }
    this.pendingChunks.push(chunk);
  }

  private commitIfReady(): void {
    if (!this.released || this.committed || this.socket?.readyState !== WebSocket.OPEN) return;
    this.committed = true;
    this.send({ v: 1, type: 'commit' });
  }

  private receive(socket: WebSocket, event: MessageEvent): void {
    if (socket !== this.socket || this.finished) return;
    if (typeof event.data !== 'string') {
      this.fail({ code: 'invalid_frame', message: 'Dictation returned an invalid response.' });
      return;
    }

    let frame: unknown;
    try {
      frame = JSON.parse(event.data);
    } catch {
      this.fail({ code: 'invalid_frame', message: 'Dictation returned an invalid response.' });
      return;
    }

    if (isTranscript(frame)) {
      this.emit('transcript', { kind: frame.kind, text: frame.text });
      if (frame.kind === 'final') this.finish();
      return;
    }
    if (isError(frame)) {
      this.fail({ code: frame.code, message: frame.message });
      return;
    }
    if (isEnded(frame)) {
      this.finish();
      return;
    }
    this.fail({ code: 'invalid_frame', message: 'Dictation returned an invalid response.' });
  }

  private fail(error: DictationError): void {
    if (this.finished) return;
    this.emit('error', error);
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.started = false;
    this.stopCapture();
    this.pendingChunks = [];
    this.pendingBytes = 0;
    this.unwatchVisibility();
    this.socket?.close();
    this.socket = undefined;
  }

  private stopCapture(): void {
    this.capture?.stop();
    this.capture = undefined;
  }

  private send(frame: object): void {
    this.socket?.send(JSON.stringify(frame));
  }

  private readonly handleVisibility = () => {
    if (document.visibilityState === 'hidden') this.cancel();
  };

  private watchVisibility(): void {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.handleVisibility);
  }

  private unwatchVisibility(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  private captureError(error: unknown): DictationError {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return { code: 'mic_denied', message: 'Microphone permission denied.' };
    }
    return { code: 'capture_error', message: `Microphone capture failed (${causeName(error)}).` };
  }

  private emit<K extends keyof DictationEventMap>(event: K, value: DictationEventMap[K]) {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }
}

/** The error's name and any HTTP status, never its message: a WebSocket URL error can carry the token. */
function causeName(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  const name = error instanceof Error ? error.name : typeof error;
  return typeof status === 'number' ? `${name} ${status}` : name;
}

function isTranscript(frame: unknown): frame is { v: 1; type: 'transcript'; kind: 'partial' | 'final'; text: string } {
  if (!frame || typeof frame !== 'object') return false;
  const value = frame as Record<string, unknown>;
  return (
    value.v === 1 &&
    value.type === 'transcript' &&
    (value.kind === 'partial' || value.kind === 'final') &&
    typeof value.text === 'string'
  );
}

function isError(frame: unknown): frame is { v: 1; type: 'error'; code: string; message: string } {
  if (!frame || typeof frame !== 'object') return false;
  const value = frame as Record<string, unknown>;
  return value.v === 1 && value.type === 'error' && typeof value.code === 'string' && typeof value.message === 'string';
}

function isEnded(frame: unknown): frame is { v: 1; type: 'ended' } {
  if (!frame || typeof frame !== 'object') return false;
  const value = frame as Record<string, unknown>;
  return value.v === 1 && value.type === 'ended';
}
