import { startCapture, type CaptureHandle } from './audio/capture.js';
import { PcmPlayer } from './audio/playback.js';
import {
  decode,
  encode,
  isServerFrame,
  type ClientFrameInput,
  type FrameOf,
  type ServerFrame,
  type ServerFrameType,
} from './wire.js';

export interface VoiceClientOptions {
  url: string;
  token: string;
  target: Record<string, unknown>;
  onLevel?: (level: number) => void;
}

export class VoiceClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VoiceClientError';
  }
}

type FrameListener = (frame: ServerFrame) => void;

export class VoiceClient {
  private readonly listeners = new Map<ServerFrameType, Set<FrameListener>>();
  private readonly player = new PcmPlayer();
  private socket: WebSocket | undefined;
  private startPromise: Promise<void> | undefined;
  private capture: CaptureHandle | undefined;
  private muted = false;
  private textEnabled = false;
  private startedAt: number | undefined;
  private stoppedAt: number | undefined;
  private ended = false;
  private endRequested = false;

  constructor(private readonly options: VoiceClientOptions) {}

  startFromGesture(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.start().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async start(): Promise<void> {
    this.ended = false;
    this.endRequested = false;
    this.muted = false;
    const playbackReady = this.player.unlock();
    const captureReady = startCapture((chunk) => this.sendAudio(chunk), this.options.onLevel);

    try {
      const capture = await captureReady;
      if (this.endRequested) {
        capture.stop();
        await playbackReady.catch(() => undefined);
        return;
      }
      this.capture = capture;
      if (this.muted) capture.setMuted(true);
      await playbackReady;
      if (this.endRequested) return;
      await this.connect();
      if (this.endRequested) return;
      this.startedAt = Date.now();
      this.stoppedAt = undefined;
      this.send({ type: 'start', target: this.options.target });
      this.watchVisibility();
    } catch (error) {
      this.stopCapture();
      if (this.endRequested) return;
      this.player.close();
      const mapped = this.startError(error);
      this.emit({ v: 1, type: 'error', code: mapped.code, message: mapped.message });
      throw mapped;
    }
  }

  end(): void {
    if (this.ended && !this.socket) return;
    this.endRequested = true;
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ type: 'end' });
    this.ended = true;
    this.finishSession(true);
    this.emit({ v: 1, type: 'ended', reason: 'user_end' });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.capture?.setMuted(muted);
  }

  sendText(text: string): void {
    if (this.textEnabled) this.send({ type: 'text', text });
  }

  confirmDraft(draftId: string, editedText?: string): void {
    this.send({
      type: 'confirm_draft',
      draft_id: draftId,
      ...(editedText === undefined ? {} : { edited_text: editedText }),
    });
  }

  discardDraft(draftId: string): void {
    this.send({ type: 'discard_draft', draft_id: draftId });
  }

  on<K extends ServerFrameType>(type: K, listener: (frame: FrameOf<K>) => void): () => void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as FrameListener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener as FrameListener);
  }

  minutes(): number {
    if (this.startedAt === undefined) return 0;
    return ((this.stoppedAt ?? Date.now()) - this.startedAt) / 60_000;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.options.url);
      url.searchParams.set('token', this.options.token);
      const socket = new WebSocket(url);
      this.socket = socket;
      let opened = false;

      socket.addEventListener(
        'open',
        () => {
          opened = true;
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          if (!opened) {
            if (this.socket === socket) this.socket = undefined;
            reject(new VoiceClientError('socket_error', 'Voice connection failed.'));
          }
        },
        { once: true },
      );
      socket.addEventListener('message', (event) => this.receive(event));
      socket.addEventListener('close', (event) => {
        if (!opened) {
          if (this.socket === socket) this.socket = undefined;
          reject(
            event.code === 4401
              ? new VoiceClientError('unauthorized', 'Voice connection was not authorized.')
              : new VoiceClientError('socket_error', 'Voice connection was rejected.'),
          );
          return;
        }
        this.handleClose(socket, event.code);
      });
    });
  }

  private receive(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      this.emitInvalidFrame('Voice socket sent a non-text frame.');
      return;
    }

    try {
      const frame = decode(event.data);
      if (!isServerFrame(frame)) {
        this.emitInvalidFrame('Voice socket sent a client-only frame.');
        return;
      }
      this.handleFrame(frame);
    } catch (error) {
      this.emitInvalidFrame(error instanceof Error ? error.message : 'Invalid voice frame.');
    }
  }

  private handleFrame(frame: ServerFrame): void {
    if (frame.type === 'agent_audio') this.player.enqueue(frame);
    if (frame.type === 'interrupted') this.player.stop();
    if (frame.type === 'state') {
      const capabilities = (frame as Record<string, unknown>).capabilities;
      this.textEnabled =
        Boolean(capabilities) &&
        typeof capabilities === 'object' &&
        (capabilities as Record<string, unknown>).text === true;
    }
    if (frame.type === 'ended') {
      this.ended = true;
      this.finishSession(true);
    }
    this.emit(frame);
  }

  private handleClose(socket: WebSocket, code: number): void {
    if (this.socket !== socket) return;

    this.socket = undefined;
    this.finishSession(false);

    if (code === 4401) {
      this.emit({
        v: 1,
        type: 'error',
        code: 'unauthorized',
        message: 'Voice connection was not authorized.',
      });
    }

    if (!this.ended) {
      this.ended = true;
      this.emit({
        v: 1,
        type: 'ended',
        reason: this.endRequested ? 'user_end' : 'transport_lost',
      });
    }
  }

  private sendAudio(dataBase64: string): void {
    if (this.muted) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: 'audio', data_b64: dataBase64 });
    }
  }

  private send(frame: ClientFrameInput): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new VoiceClientError('not_connected', 'Voice socket is not connected.');
    }
    this.socket.send(encode(frame));
  }

  private emit(frame: ServerFrame): void {
    for (const listener of this.listeners.get(frame.type as ServerFrameType) ?? []) {
      listener(frame);
    }
  }

  private emitInvalidFrame(message: string): void {
    this.emit({ v: 1, type: 'error', code: 'invalid_frame', message });
  }

  private stopCapture(): void {
    this.capture?.stop();
    this.capture = undefined;
  }

  private finishTimer(): void {
    if (this.startedAt !== undefined && this.stoppedAt === undefined) this.stoppedAt = Date.now();
  }

  private finishSession(closeSocket: boolean): void {
    this.finishTimer();
    this.stopCapture();
    this.player.close();
    this.unwatchVisibility();
    if (!closeSocket) return;
    const socket = this.socket;
    this.socket = undefined;
    if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) socket.close();
  }

  private readonly handleVisibility = () => {
    if (document.visibilityState === 'hidden') this.end();
  };

  private watchVisibility(): void {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.handleVisibility);
  }

  private unwatchVisibility(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  private startError(error: unknown): VoiceClientError {
    if (error instanceof VoiceClientError) return error;
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return new VoiceClientError('mic_denied', 'Microphone permission denied.', { cause: error });
    }
    return new VoiceClientError('start_failed', 'Voice session could not start.', { cause: error });
  }
}
